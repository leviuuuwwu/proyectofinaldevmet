import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrderBy, buildSearchSql } from "./search.ts";

describe("buildOrderBy", () => {
	it("orders by relevance only when there is text", () => {
		assert.equal(
			buildOrderBy("relevance", true),
			"rank DESC, published_at DESC, id ASC",
		);
		assert.equal(buildOrderBy("relevance", false), "published_at DESC, id ASC");
		assert.equal(buildOrderBy("date", true), "published_at DESC, id ASC");
	});
});

describe("buildSearchSql", () => {
	const base = { sort: "relevance" as const, page: 1, pageSize: 20 };

	it("has no WHERE and a zero rank without filters", () => {
		assert.deepEqual(buildSearchSql(base), {
			where: "",
			rank: "0::float4",
			values: [],
		});
	});

	it("combines text, tags and category with numbered parameters", () => {
		const sql = buildSearchSql({
			...base,
			q: "respaldo postgres",
			tags: ["postgres", "respaldo"],
			category: "operaciones",
		});
		assert.equal(
			sql.where,
			"WHERE tsv @@ websearch_to_tsquery('spanish', $1) AND tags @> $2::text[] AND category = $3",
		);
		assert.equal(sql.rank, "ts_rank(tsv, websearch_to_tsquery('spanish', $1))");
		assert.deepEqual(sql.values, [
			"respaldo postgres",
			["postgres", "respaldo"],
			"operaciones",
		]);
	});

	it("never interpolates user input into the SQL text", () => {
		const sql = buildSearchSql({ ...base, q: "'; DROP TABLE documents; --" });
		assert.ok(!sql.where.includes("DROP"));
		assert.ok(!sql.rank.includes("DROP"));
	});
});
