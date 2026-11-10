// Build identity: version from package.json, commit and build time from the image
// (GIT_SHA / BUILT_AT build args exported as ENV, see docs/contracts/runtime.md).
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
	readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

export const buildInfo = {
	version: pkg.version,
	commit: process.env.GIT_SHA || "unknown",
	builtAt: process.env.BUILT_AT || "unknown",
} as const;
