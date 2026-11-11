// Golden: /search over the deterministic dataset against expected results that were computed
// WITHOUT the API or PostgreSQL (oracle.ts, committed as expected.json). HTTP only (P4-1).
//
// Isolation: every document carries a per-run tag and every query adds it, so the result is the
// same whatever else is in the database. Run `npm run db:reset` first for a fully clean state.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { buildDataset, COUNT, SEED } from "./dataset.ts";
import { decode, type Expected, encode, expectedFor, type QuerySpec } from "./oracle.ts";
import { buildQueries } from "./queries.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const TOKEN = {
	reader: process.env.READER_TOKEN ?? "dev-reader-token",
	editor: process.env.EDITOR_TOKEN ?? "dev-editor-token",
};
const CONVERGENCE_TIMEOUT_MS = 120_000;

const fixture = JSON.parse(
	readFileSync(new URL("./expected.json", import.meta.url), "utf8"),
) as {
	seed: number;
	count: number;
	queries: Record<string, { total: number; order: string }>;
};

const { created, changes, final } = buildDataset();
const queries = buildQueries(final);
const publishedCount = final.filter((d) => d.published).length;
const runTag = `gld${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

async function call<T>(
	method: string,
	path: string,
	role: "reader" | "editor",
	body?: unknown,
	ifMatch?: number,
) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${TOKEN[role]}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

interface Hit {
	id: string;
	rank: number;
}

/** Walks every page of a query. Always adds the run tag to isolate this run's documents. */
async function fetchAll(
	spec: QuerySpec,
	sort: "date" | "relevance",
	pageSize = 50,
): Promise<{ total: number; hits: Hit[] }> {
	const hits: Hit[] = [];
	let total = 0;
	for (let page = 1; page <= 5000; page++) {
		const params = new URLSearchParams();
		if (spec.q !== undefined) params.set("q", spec.q);
		if (spec.category !== undefined) params.set("category", spec.category);
		for (const tag of [runTag, ...(spec.tags ?? [])]) params.append("tags", tag);
		params.set("sort", sort);
		params.set("page", String(page));
		params.set("pageSize", String(pageSize));
		const res = await call<{ total: number; items: Hit[] }>(
			"GET",
			`/search?${params}`,
			"reader",
		);
		assert.equal(res.status, 200, JSON.stringify(res.body));
		total = res.body.total;
		hits.push(...res.body.items);
		if (res.body.items.length === 0 || hits.length >= total) break;
	}
	return { total, hits };
}

const ids: string[] = new Array(COUNT);
const indexOfId = new Map<string, number>();
const toIndices = (hits: Hit[]) =>
	hits.map((h) => {
		const index = indexOfId.get(h.id);
		assert.notEqual(index, undefined, `unknown id ${h.id} (not from this run)`);
		return index as number;
	});

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

function describeDiff(actual: number[], expected: number[]): string {
	const a = new Set(actual);
	const e = new Set(expected);
	const missing = expected.filter((x) => !a.has(x));
	const extra = actual.filter((x) => !e.has(x));
	return `missing=[${missing.slice(0, 10)}] extra=[${extra.slice(0, 10)}]`;
}

/** Same set per equal-date group, groups in date order, ids ascending inside each group. */
function assertDateOrder(hits: Hit[], expected: Expected, name: string) {
	const indices = toIndices(hits);
	let cursor = 0;
	expected.groups.forEach((group, g) => {
		const slice = indices.slice(cursor, cursor + group.length);
		assert.deepEqual(
			sorted(slice),
			group,
			`${name}: date group #${g} differs (${describeDiff(slice, group)})`,
		);
		const groupIds = hits.slice(cursor, cursor + group.length).map((h) => h.id);
		assert.deepEqual(
			groupIds,
			[...groupIds].sort(),
			`${name}: ties within date group #${g} must be ordered by id ASC`,
		);
		cursor += group.length;
	});
	assert.equal(cursor, hits.length, `${name}: no extra results beyond the expected`);
}

describe("el fixture expected.json está al día con el oráculo", () => {
	it("usa la misma semilla y tamaño que el conjunto de datos", () => {
		assert.equal(fixture.seed, SEED);
		assert.equal(fixture.count, COUNT);
	});

	it("tiene exactamente las consultas definidas, con los resultados que calcula el oráculo", () => {
		assert.deepEqual(
			Object.keys(fixture.queries).sort(),
			queries.map((q) => q.name).sort(),
			"query list differs: run `node tests/golden/update-expected.ts`",
		);
		for (const spec of queries) {
			assert.deepEqual(
				fixture.queries[spec.name],
				encode(expectedFor(spec, final)),
				`${spec.name}: expected.json is stale; run \`node tests/golden/update-expected.ts\``,
			);
		}
	});

	it("el conjunto no es trivial (hay publicados y no publicados)", () => {
		assert.ok(publishedCount > COUNT * 0.6 && publishedCount < COUNT);
		assert.ok(changes.some((c) => c.kind === "update"));
		assert.ok(changes.some((c) => c.kind === "unpublish"));
		const nonEmpty = queries.filter(
			(q) => (fixture.queries[q.name]?.total ?? 0) > 0,
		).length;
		assert.ok(nonEmpty >= queries.length - 3, "almost every query has results");
	});
});

describe("golden de /search contra la API", () => {
	before(async () => {
		// 1. Create (bounded concurrency).
		const versions: number[] = new Array(COUNT).fill(1);
		let next = 0;
		await Promise.all(
			Array.from({ length: 10 }, async () => {
				while (next < COUNT) {
					const i = next++;
					const doc = created[i];
					const res = await call<{ id: string }>("POST", "/documents", "editor", {
						...doc,
						tags: [...(doc?.tags ?? []), runTag],
					});
					assert.equal(res.status, 201, `create #${i}: ${JSON.stringify(res.body)}`);
					ids[i] = res.body.id;
					indexOfId.set(res.body.id, i);
				}
			}),
		);

		// 2. Apply the deterministic changes (sequential per document, so If-Match is current).
		for (const change of changes) {
			const id = ids[change.index] as string;
			if (change.kind === "update") {
				const res = await call<{ version: number }>(
					"PUT",
					`/documents/${id}`,
					"editor",
					{ ...change.doc, tags: [...change.doc.tags, runTag] },
					versions[change.index],
				);
				assert.equal(res.status, 200, `update #${change.index}`);
				versions[change.index] = res.body.version;
			} else {
				const res = await call<{ version: number }>(
					"POST",
					`/documents/${id}/unpublish`,
					"editor",
				);
				assert.equal(res.status, 200, `unpublish #${change.index}`);
				versions[change.index] = res.body.version;
			}
		}

		// 3. Wait for the index to converge, as docs/guia-pruebas-api.md prescribes.
		const deadline = Date.now() + CONVERGENCE_TIMEOUT_MS;
		for (;;) {
			const status = await call<{ pending: number; failed: number }>(
				"GET",
				"/index/status",
				"editor",
			);
			if (status.body.pending === 0 && status.body.failed === 0) break;
			assert.ok(Date.now() < deadline, "index did not converge in time");
			await new Promise((r) => setTimeout(r, 200));
		}
		const all = await fetchAll({ name: "all" }, "date");
		assert.equal(
			all.total,
			publishedCount,
			"the index holds exactly the published documents of this run",
		);
	});

	for (const spec of queries) {
		const expected = decode(
			fixture.queries[spec.name] as { total: number; order: string },
		);

		it(`${spec.name}: total y orden por fecha`, async () => {
			const { total, hits } = await fetchAll(spec, "date");
			assert.equal(total, expected.total, `${spec.name}: total`);
			assert.equal(hits.length, expected.total);
			assertDateOrder(hits, expected, spec.name);
		});

		it(`${spec.name}: relevance devuelve el mismo conjunto, con rank no creciente`, async () => {
			const { total, hits } = await fetchAll(spec, "relevance");
			assert.equal(total, expected.total);
			assert.deepEqual(
				sorted(toIndices(hits)),
				sorted(expected.groups.flat()),
				`${spec.name}: relevance set`,
			);
			for (let i = 1; i < hits.length; i++) {
				assert.ok(
					(hits[i - 1] as Hit).rank >= (hits[i] as Hit).rank,
					`${spec.name}: rank must not increase`,
				);
			}
			if (spec.q === undefined) {
				for (const hit of hits) assert.equal(hit.rank, 0, "no q → rank 0");
			}
		});
	}

	it("las categorías particionan el conjunto: sus totales suman todos los publicados", () => {
		const categoryQueries = queries.filter((q) => q.name.startsWith("category:"));
		const sum = categoryQueries.reduce(
			(acc, q) => acc + (fixture.queries[q.name]?.total ?? 0),
			0,
		);
		assert.equal(sum, publishedCount);
	});

	it("la paginación recorre el mismo orden, sin duplicados ni huecos, con distintos pageSize", async () => {
		const biggest = queries
			.filter((q) => q.name.startsWith("category:"))
			.sort(
				(a, b) =>
					(fixture.queries[b.name]?.total ?? 0) -
					(fixture.queries[a.name]?.total ?? 0),
			)[0] as QuerySpec;
		const reference = await fetchAll(biggest, "date", 50);
		assert.ok(reference.total > 20);
		for (const pageSize of [1, 7, 20]) {
			const paged = await fetchAll(biggest, "date", pageSize);
			assert.equal(paged.total, reference.total);
			assert.deepEqual(
				paged.hits.map((h) => h.id),
				reference.hits.map((h) => h.id),
				`pageSize ${pageSize} must walk the same order`,
			);
			assert.equal(new Set(paged.hits.map((h) => h.id)).size, paged.hits.length);
		}
	});
});
