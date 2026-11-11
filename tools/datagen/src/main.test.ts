// Runs the generator as a real process against an in-memory fake of the API contract.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

interface Stored {
	version: number;
	status: string;
}

/** failedPolls: how many /index/status polls report failed=1 (Infinity = never recovers). */
function startFakeApi(failedPolls = 0) {
	const docs = new Map<string, Stored>();
	const stats = {
		created: 0,
		put: 0,
		conflicts: 0,
		unpublish: 0,
		badAuth: 0,
		polls: 0,
	};
	let statusCalls = 0;

	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			const send = (status: number, body?: unknown) => {
				res.writeHead(status, { "content-type": "application/json" });
				res.end(body === undefined ? "" : JSON.stringify(body));
			};
			if (req.headers.authorization !== "Bearer test-token") {
				stats.badAuth++;
				return send(401, { status: 401 });
			}
			const url = req.url ?? "";
			const body = chunks.length
				? JSON.parse(Buffer.concat(chunks).toString())
				: undefined;

			if (req.method === "POST" && url === "/documents") {
				assert.ok(body.title && body.category && body.date && body.status);
				const id = randomUUID();
				docs.set(id, { version: 1, status: body.status });
				stats.created++;
				return send(201, { id, version: 1, indexState: "pending" });
			}
			const put = /^\/documents\/([^/]+)$/.exec(url);
			if (req.method === "PUT" && put) {
				const doc = docs.get(put[1] as string);
				if (!doc) return send(404, { status: 404 });
				const expected = Number(
					String(req.headers["if-match"] ?? "").replaceAll('"', ""),
				);
				if (expected !== doc.version) {
					stats.conflicts++;
					return send(409, { status: 409 });
				}
				doc.version++;
				doc.status = body.status;
				stats.put++;
				return send(200, {
					id: put[1],
					version: doc.version,
					indexState: "pending",
				});
			}
			const unpub = /^\/documents\/([^/]+)\/unpublish$/.exec(url);
			if (req.method === "POST" && unpub) {
				const doc = docs.get(unpub[1] as string);
				if (!doc) return send(404, { status: 404 });
				if (doc.status !== "unpublished") {
					doc.status = "unpublished";
					doc.version++;
				}
				stats.unpublish++;
				return send(200, {
					id: unpub[1],
					version: doc.version,
					indexState: "pending",
				});
			}
			if (req.method === "GET" && url === "/index/status") {
				// Converges after a few polls, like the real indexer would.
				stats.polls++;
				const pending = Math.max(0, 2 - statusCalls);
				const failed = statusCalls < failedPolls ? 1 : 0;
				statusCalls++;
				return send(200, {
					pending,
					failed,
					oldestPendingAgeSeconds: null,
					lastIndexedAt: null,
				});
			}
			send(404, { status: 404 });
		});
	});

	return new Promise<{
		baseUrl: string;
		stats: typeof stats;
		close: () => void;
	}>((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve({
				baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
				stats,
				close: () => server.close(),
			}),
		),
	);
}

function runDatagen(env: Record<string, string>) {
	return new Promise<{ code: number | null; out: string }>((resolve) => {
		const child = spawn(process.execPath, ["src/main.ts"], {
			cwd: import.meta.dirname.replace(/[\\/]src$/, ""),
			env: { ...process.env, ...env },
		});
		let out = "";
		child.stdout.on("data", (d) => {
			out += d;
		});
		child.stderr.on("data", (d) => {
			out += d;
		});
		child.on("close", (code) => resolve({ code, out }));
	});
}

describe("datagen main against a fake API", () => {
	it("creates, changes and waits for the index to converge", async () => {
		const api = await startFakeApi();
		try {
			const { code, out } = await runDatagen({
				BASE_URL: api.baseUrl,
				EDITOR_TOKEN: "test-token",
				DOCS: "60",
				POLL_MS: "10",
				CHANGES: "20",
			});
			assert.equal(code, 0, out);
			const summary = JSON.parse(out.trim().split("\n").at(-1) as string);
			assert.equal(summary.created, 60);
			assert.equal(summary.updated + summary.unpublished, 20);
			assert.equal(summary.failures, 0);
			assert.equal(summary.pending, 0);
			assert.equal(api.stats.created, 60);
			assert.equal(api.stats.conflicts, 0, "If-Match must always be current");
			assert.equal(api.stats.badAuth, 0);
		} finally {
			api.close();
		}
	});

	it("keeps polling until failed is 0 too, not only pending", async () => {
		const api = await startFakeApi(6);
		try {
			const { code, out } = await runDatagen({
				BASE_URL: api.baseUrl,
				EDITOR_TOKEN: "test-token",
				DOCS: "5",
				CHANGES: "2",
				POLL_MS: "10",
			});
			assert.equal(code, 0, out);
			const summary = JSON.parse(out.trim().split("\n").at(-1) as string);
			assert.equal(summary.pending, 0);
			assert.equal(summary.failed, 0);
			assert.ok(api.stats.polls > 6, "must wait past the failed=1 polls");
		} finally {
			api.close();
		}
	});

	it("exits 1 when failed never returns to 0", async () => {
		const api = await startFakeApi(Number.POSITIVE_INFINITY);
		try {
			const { code, out } = await runDatagen({
				BASE_URL: api.baseUrl,
				EDITOR_TOKEN: "test-token",
				DOCS: "5",
				CHANGES: "2",
				POLL_MS: "10",
				WAIT_TIMEOUT_MS: "300",
			});
			assert.equal(code, 1, out);
			const summary = JSON.parse(out.trim().split("\n").at(-1) as string);
			assert.equal(summary.failed, 1);
		} finally {
			api.close();
		}
	});

	it("fails fast without EDITOR_TOKEN", async () => {
		const { code, out } = await runDatagen({ EDITOR_TOKEN: "" });
		assert.equal(code, 1);
		assert.match(out, /EDITOR_TOKEN is required/);
	});
});
