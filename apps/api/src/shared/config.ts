// Configuration loading and validation (docs/contracts/runtime.md).
// Error messages name the variable and the rule, never the value.

export type Component = "api" | "indexer" | "migrate";
export type Role = "reader" | "editor" | "admin";
export type AppEnv = "dev" | "prod";

export interface AuthToken {
	sub: string;
	role: Role;
	sha256: Buffer;
}

export interface Config {
	component: Component;
	appEnv: AppEnv;
	port: number;
	databaseUrl: string;
	authTokens: AuthToken[];
	logLevel: string;
	otelServiceName: string;
	otelEndpoint: string | undefined;
	indexer: { batchSize: number; pollMs: number; maxAttempts: number };
}

export type ConfigResult =
	| { ok: true; config: Config }
	| { ok: false; errors: string[] };

const ROLES: readonly Role[] = ["reader", "editor", "admin"];
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"];
const DEFAULT_PORT: Record<Component, number> = {
	api: 8080,
	indexer: 9090,
	migrate: 0,
};

export function parseConfig(
	component: Component,
	env: NodeJS.ProcessEnv,
): ConfigResult {
	const errors: string[] = [];

	const int = (name: string, def: number, min: number, max: number) => {
		const raw = env[name];
		if (raw === undefined || raw === "") return def;
		const n = Number(raw);
		if (!Number.isInteger(n) || n < min || n > max) {
			errors.push(`${name} must be an integer between ${min} and ${max}`);
		}
		return n;
	};

	const appEnv = env.APP_ENV;
	if (appEnv !== "dev" && appEnv !== "prod") {
		errors.push("APP_ENV is required and must be 'dev' or 'prod'");
	}

	const databaseUrl = env.DATABASE_URL ?? "";
	if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
		errors.push(
			"DATABASE_URL is required and must start with postgres:// or postgresql://",
		);
	}

	const logLevel = env.LOG_LEVEL || "info";
	if (!LOG_LEVELS.includes(logLevel)) {
		errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
	}

	const otelEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined;
	if (otelEndpoint !== undefined && !/^https?:\/\//.test(otelEndpoint)) {
		errors.push("OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL");
	}

	const authTokens =
		component === "api" ? parseAuthTokens(env.AUTH_TOKENS_JSON, errors) : [];

	const config: Config = {
		component,
		appEnv: appEnv as AppEnv,
		port: int("PORT", DEFAULT_PORT[component], 1, 65535),
		databaseUrl,
		authTokens,
		logLevel,
		otelServiceName:
			env.OTEL_SERVICE_NAME ||
			(component === "indexer" ? "search-indexer" : "search-api"),
		otelEndpoint,
		indexer: {
			batchSize: int("INDEXER_BATCH_SIZE", 100, 1, 1000),
			pollMs: int("INDEXER_POLL_MS", 1000, 50, 60000),
			maxAttempts: int("INDEXER_MAX_ATTEMPTS", 5, 1, 100),
		},
	};

	return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}

function parseAuthTokens(
	raw: string | undefined,
	errors: string[],
): AuthToken[] {
	const rule = "AUTH_TOKENS_JSON must be a JSON array of {sub, role, sha256}";
	if (!raw) {
		errors.push(`${rule} (missing)`);
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		errors.push(`${rule} (invalid JSON)`);
		return [];
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		errors.push(`${rule} (empty or not an array)`);
		return [];
	}
	const tokens: AuthToken[] = [];
	parsed.forEach((entry: unknown, i) => {
		const e = entry as Record<string, unknown> | null;
		if (
			typeof e?.sub !== "string" ||
			e.sub === "" ||
			!ROLES.includes(e.role as Role) ||
			typeof e.sha256 !== "string" ||
			!/^[0-9a-f]{64}$/.test(e.sha256)
		) {
			errors.push(
				`${rule} (entry ${i}: sub non-empty, role reader|editor|admin, sha256 64 hex)`,
			);
			return;
		}
		tokens.push({
			sub: e.sub,
			role: e.role as Role,
			sha256: Buffer.from(e.sha256, "hex"),
		});
	});
	return tokens;
}
