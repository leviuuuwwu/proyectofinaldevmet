import pg from "pg";
import type { Config } from "./config.ts";

export type Pool = pg.Pool;

export function createPool(config: Config): pg.Pool {
	return new pg.Pool({
		connectionString: config.databaseUrl,
		application_name: `search-${config.component}`,
		connectionTimeoutMillis: 2000,
		max: 10,
	});
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
