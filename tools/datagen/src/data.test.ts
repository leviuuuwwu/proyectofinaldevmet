import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRng, generateDocuments } from "./data.ts";

describe("datagen", () => {
	it("same seed → same dataset", () => {
		assert.deepEqual(
			generateDocuments(createRng(42), 50),
			generateDocuments(createRng(42), 50),
		);
	});

	it("documents respect the contract limits", () => {
		for (const d of generateDocuments(createRng(7), 500)) {
			assert.ok(d.title.length >= 1 && d.title.length <= 200);
			assert.ok(d.description.length <= 2000);
			assert.ok(d.tags.length <= 10 && new Set(d.tags).size === d.tags.length);
			for (const t of d.tags) assert.match(t, /^[a-z0-9-]{1,40}$/);
			assert.ok(d.category.length >= 1 && d.category.length <= 50);
			assert.ok(!Number.isNaN(Date.parse(d.date)));
		}
	});
});
