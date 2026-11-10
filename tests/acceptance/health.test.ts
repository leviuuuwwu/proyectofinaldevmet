// Acceptance: ops endpoints and cross-cutting contract rules, HTTP only.
// BASE_URL defaults to the local API.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const get = (path: string, init?: RequestInit) =>
	fetch(`${BASE_URL}${path}`, init);

describe("ops endpoints", () => {
	it("GET /healthz → 200 {status: ok}", async () => {
		const res = await get("/healthz");
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { status: "ok" });
	});

	it("GET /readyz → 200 when the database is reachable", async () => {
		const res = await get("/readyz");
		assert.equal(res.status, 200);
	});

	it("GET /version → version, commit, builtAt", async () => {
		const res = await get("/version");
		assert.equal(res.status, 200);
		const body = (await res.json()) as Record<string, unknown>;
		for (const key of ["version", "commit", "builtAt"]) {
			assert.equal(typeof body[key], "string", key);
		}
	});

	it("GET /metrics exposes app_build_info", async () => {
		const res = await get("/metrics");
		assert.equal(res.status, 200);
		assert.match(await res.text(), /app_build_info\{.*component="api".*\} 1/);
	});
});

describe("cross-cutting rules", () => {
	it("echoes a valid X-Correlation-Id", async () => {
		const res = await get("/healthz", {
			headers: { "x-correlation-id": "acceptance-test-0001" },
		});
		assert.equal(res.headers.get("x-correlation-id"), "acceptance-test-0001");
	});

	it("unknown route → 404 problem+json with correlationId", async () => {
		const res = await get("/does-not-exist");
		assert.equal(res.status, 404);
		assert.match(
			res.headers.get("content-type") ?? "",
			/application\/problem\+json/,
		);
		const body = (await res.json()) as Record<string, unknown>;
		assert.equal(body.status, 404);
		assert.equal(body.correlationId, res.headers.get("x-correlation-id"));
	});

	it("protected route without token → 401 problem+json", async () => {
		const res = await get("/search?q=respaldo");
		assert.equal(res.status, 401);
		assert.equal(res.headers.get("www-authenticate"), "Bearer");
		assert.match(
			res.headers.get("content-type") ?? "",
			/application\/problem\+json/,
		);
	});
});
