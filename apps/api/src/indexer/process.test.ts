import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveIndexState } from "../api/indexing.ts";
import { decide } from "./process.ts";

describe("decide", () => {
	it("applies only versions newer than the indexed one", () => {
		assert.equal(decide(1, 0), "apply");
		assert.equal(decide(3, 2), "apply");
	});

	it("skips duplicates and out-of-order events", () => {
		assert.equal(decide(2, 2), "stale_skipped");
		assert.equal(decide(1, 3), "stale_skipped");
	});
});

describe("deriveIndexState", () => {
	it("is indexed once the catalog version is applied, even after errors", () => {
		assert.equal(deriveIndexState(3, 3, false), "indexed");
		assert.equal(deriveIndexState(3, 4, true), "indexed");
	});

	it("is failed when a pending event recorded an error", () => {
		assert.equal(deriveIndexState(3, 2, true), "failed");
	});

	it("is pending otherwise (including never indexed)", () => {
		assert.equal(deriveIndexState(3, 2, false), "pending");
		assert.equal(deriveIndexState(1, 0, false), "pending");
	});
});
