import pg from "pg";
import type { Config } from "./config.ts";
import type { Logger } from "./logger.ts";

export type Pool = pg.Pool;

export function createPool(config: Config, logger: Logger): pg.Pool {
	const pool = new pg.Pool({
		connectionString: config.databaseUrl,
		application_name: `search-${config.component}`,
		connectionTimeoutMillis: 2000,
		max: 10,
	});
	// An idle client whose connection drops (database restart, 57P01) emits 'error' on
	// the pool; unhandled, Node kills the process. The pool discards that client and
	// later queries reconnect, so it is logged and the process keeps running.
	pool.on("error", (err) => {
		logger.warn(
			{
				event: "db.connection_lost",
				outcome: "failure",
				code: (err as { code?: string }).code,
				err,
			},
			"idle database connection lost",
		);
	});
	return pool;
}

export async function isDatabaseReachable(pool: pg.Pool): Promise<boolean> {
	try {
		await pool.query({
			text: "SELECT 1",
			query_timeout: 2000,
		} as pg.QueryConfig);
		return true;
	} catch {
		return false;
	}
}
