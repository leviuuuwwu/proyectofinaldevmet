import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { authenticate, hasRole } from "./auth.ts";
import type { AuthToken } from "./config.ts";

const token = (sub: string, role: AuthToken["role"], plain: string) => ({
	sub,
	role,
	sha256: createHash("sha256").update(plain).digest(),
});
const tokens = [
	token("r", "reader", "reader-token"),
	token("e", "editor", "editor-token"),
];

describe("authenticate", () => {
	it("accepts a known bearer token", () => {
		assert.deepEqual(authenticate("Bearer editor-token", tokens), {
			sub: "e",
			role: "editor",
		});
	});

	it("rejects missing, malformed and unknown tokens", () => {
		assert.equal(authenticate(undefined, tokens), null);
		assert.equal(authenticate("editor-token", tokens), null);
		assert.equal(authenticate("Basic editor-token", tokens), null);
		assert.equal(authenticate("Bearer wrong", tokens), null);
	});
});

describe("hasRole", () => {
	it("applies the admin > editor > reader hierarchy", () => {
		assert.equal(hasRole({ sub: "a", role: "admin" }, "editor"), true);
		assert.equal(hasRole({ sub: "e", role: "editor" }, "reader"), true);
		assert.equal(hasRole({ sub: "r", role: "reader" }, "editor"), false);
		assert.equal(hasRole({ sub: "e", role: "editor" }, "admin"), false);
	});
});
