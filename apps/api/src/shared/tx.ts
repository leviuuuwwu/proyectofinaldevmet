import type pg from "pg";
import type { Pool } from "./db.ts";

export type Client = pg.PoolClient;

export interface TxOptions {
	isolation?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
	readOnly?: boolean;
}

// Runs fn inside BEGIN/COMMIT on a dedicated client; rolls back on any error.
export async function withTransaction<T>(
	pool: Pool,
	fn: (client: Client) => Promise<T>,
	options: TxOptions = {},
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query(
			`BEGIN ISOLATION LEVEL ${options.isolation ?? "READ COMMITTED"}${options.readOnly ? " READ ONLY" : ""}`,
		);
		const result = await fn(client);
		await client.query("COMMIT");
		return result;
	} catch (err) {
		await client.query("ROLLBACK").catch(() => {});
		throw err;
	} finally {
		client.release();
	}
}
