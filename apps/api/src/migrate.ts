// Minimal migration runner: plain SQL files in apps/api/migrations (NNN_name.sql),
// each applied in its own transaction and recorded in schema_migrations.
// An advisory lock prevents two runners (e.g. two Jobs) from migrating at once.
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { loadConfigOrExit } from "./shared/bootstrap.ts";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
const LOCK_ID = 4_204_2026;

const { config, logger } = loadConfigOrExit("migrate");
const client = new pg.Client({
	connectionString: config.databaseUrl,
	application_name: "search-migrate",
});

try {
	await client.connect();
	await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
	await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`);

	const applied = new Set(
		(
			await client.query<{ version: string }>(
				"SELECT version FROM schema_migrations",
			)
		).rows.map((r) => r.version),
	);
	const files = (await readdir(MIGRATIONS_DIR))
		.filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
		.sort();

	let count = 0;
	for (const file of files) {
		if (applied.has(file)) continue;
		const started = performance.now();
		const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
		try {
			await client.query("BEGIN");
			await client.query(sql);
			await client.query(
				"INSERT INTO schema_migrations (version) VALUES ($1)",
				[file],
			);
			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK");
			throw Object.assign(err as Error, { migration: file });
		}
		count++;
		logger.info(
			{
				event: "migration.applied",
				outcome: "success",
				migration: file,
				durationMs: Math.round(performance.now() - started),
			},
			"migration applied",
		);
	}
	logger.info(
		{ event: "migration.finished", outcome: "success", applied: count },
		"migrations up to date",
	);
} catch (err) {
	logger.error(
		{ event: "migration.failed", outcome: "failure", err },
		"migration failed",
	);
	process.exitCode = 1;
} finally {
	await client.end().catch(() => {});
}
