import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type DocumentRow,
	opForStatus,
	parseIfMatch,
	toDocumentDto,
} from "./catalog.ts";

describe("parseIfMatch", () => {
	it("accepts bare and quoted versions", () => {
		assert.equal(parseIfMatch("3"), 3);
		assert.equal(parseIfMatch('"42"'), 42);
		assert.equal(parseIfMatch(' "7" '), 7);
	});

	it("rejects anything that is not a positive int4", () => {
		for (const value of [
			undefined,
			"",
			"0",
			"-1",
			"abc",
			"1.5",
			'W/"3"',
			"9999999999",
		]) {
			assert.equal(parseIfMatch(value), null, String(value));
		}
	});
});

describe("opForStatus", () => {
	it("indexes only published documents", () => {
		assert.equal(opForStatus("published"), "upsert");
		assert.equal(opForStatus("draft"), "delete");
		assert.equal(opForStatus("unpublished"), "delete");
	});
});

describe("toDocumentDto", () => {
	it("maps columns to the contract shape", () => {
		const row: DocumentRow = {
			id: "0b8e6c2a-5d1f-4a7e-9c3b-2f1e0d9c8b7a",
			title: "T",
			description: "",
			tags: ["a"],
			category: "c",
			date: new Date("2026-10-01T00:00:00Z"),
			status: "published",
			version: 2,
			created_at: new Date("2026-11-01T10:00:00Z"),
			updated_at: new Date("2026-11-02T08:30:00Z"),
		};
		assert.deepEqual(toDocumentDto(row), {
			id: row.id,
			title: "T",
			description: "",
			tags: ["a"],
			category: "c",
			date: "2026-10-01T00:00:00.000Z",
			status: "published",
			version: 2,
			createdAt: "2026-11-01T10:00:00.000Z",
			updatedAt: "2026-11-02T08:30:00.000Z",
		});
	});
});
