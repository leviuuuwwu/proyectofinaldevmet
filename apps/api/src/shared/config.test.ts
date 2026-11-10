import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { parseConfig } from "./config.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const base = {
	APP_ENV: "dev",
	DATABASE_URL: "postgres://user:fake-password@localhost:5432/db",
	AUTH_TOKENS_JSON: JSON.stringify([
		{ sub: "r", role: "reader", sha256: sha("reader-token") },
	]),
};

describe("parseConfig", () => {
	it("applies defaults per component", () => {
		const api = parseConfig("api", base);
		assert.ok(api.ok);
		assert.equal(api.config.port, 8080);
		assert.equal(api.config.logLevel, "info");
		assert.equal(api.config.authTokens.length, 1);

		const indexer = parseConfig("indexer", { ...base, AUTH_TOKENS_JSON: "" });
		assert.ok(indexer.ok);
		assert.equal(indexer.config.port, 9090);
		assert.equal(indexer.config.indexer.batchSize, 100);
	});

	it("reports every invalid variable without leaking values", () => {
		const result = parseConfig("api", {
			APP_ENV: "staging",
			DATABASE_URL: "mysql://secret-value@host/db",
			AUTH_TOKENS_JSON: '[{"sub":"x","role":"root","sha256":"abc"}]',
			PORT: "70000",
		});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.errors.length, 4);
		assert.ok(result.errors.every((e) => !e.includes("secret-value")));
	});

	it("requires auth tokens only for the api", () => {
		assert.equal(
			parseConfig("api", { ...base, AUTH_TOKENS_JSON: undefined }).ok,
			false,
		);
		assert.equal(
			parseConfig("migrate", { ...base, AUTH_TOKENS_JSON: undefined }).ok,
			true,
		);
	});
});
