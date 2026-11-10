// Indexing status (ESC4-06, ESC4-09): distinguishes "saved in the catalog" from
// "applied to the search index", and exposes pending work and errors.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "../shared/db.ts";
import { sendProblem } from "../shared/problem.ts";

export type IndexState = "pending" | "indexed" | "failed";

// indexed wins: once the current version is applied, older errors are irrelevant.
// failed: an unprocessed event for this document recorded an error.
export function deriveIndexState(
	catalogVersion: number,
	indexedVersion: number,
	hasFailedEvent: boolean,
): IndexState {
	if (indexedVersion >= catalogVersion) return "indexed";
	return hasFailedEvent ? "failed" : "pending";
}

interface StatusRow {
	version: number;
	updated_at: Date;
	indexed_version: number | null;
	indexed_at: Date | null;
	state_error: string | null;
	event_error: string | null;
}

export function indexingHandlers(pool: Pool) {
	return {
		async documentStatus(
			request: FastifyRequest<{ Params: { id: string } }>,
			reply: FastifyReply,
		) {
			const { rows } = await pool.query<StatusRow>(
				`SELECT d.version, d.updated_at, s.indexed_version, s.indexed_at,
				        s.last_error AS state_error,
				        (SELECT o.last_error FROM outbox o
				          WHERE o.doc_id = d.id AND o.processed_at IS NULL
				            AND o.last_error IS NOT NULL
				          ORDER BY o.id DESC LIMIT 1) AS event_error
				 FROM documents d LEFT JOIN index_state s ON s.doc_id = d.id
				 WHERE d.id = $1`,
				[request.params.id],
			);
			const row = rows[0];
			if (!row) {
				return sendProblem(reply, 404, {
					type: "/problems/not-found",
					title: "Not found",
				});
			}
			const indexed = row.indexed_version ?? 0;
			const state = deriveIndexState(
				row.version,
				indexed,
				row.event_error !== null,
			);
			return {
				docId: request.params.id,
				catalogVersion: row.version,
				indexedVersion: indexed > 0 ? indexed : null,
				state,
				lastError:
					state === "indexed" ? null : (row.event_error ?? row.state_error),
				committedAt: row.updated_at.toISOString(),
				indexedAt: indexed > 0 ? (row.indexed_at?.toISOString() ?? null) : null,
			};
		},

		async globalStatus() {
			const [outbox, state] = await Promise.all([
				pool.query<{
					pending: number;
					failed: number;
					oldest: number | null;
				}>(
					`SELECT count(*) FILTER (WHERE last_error IS NULL)::int AS pending,
					        count(*) FILTER (WHERE last_error IS NOT NULL)::int AS failed,
					        EXTRACT(EPOCH FROM now() - min(created_at))::float8 AS oldest
					 FROM outbox WHERE processed_at IS NULL`,
				),
				pool.query<{ last: Date | null }>(
					"SELECT max(indexed_at) AS last FROM index_state WHERE indexed_version > 0",
				),
			]);
			const o = outbox.rows[0];
			return {
				pending: o?.pending ?? 0,
				failed: o?.failed ?? 0,
				oldestPendingAgeSeconds: o?.oldest ?? null,
				lastIndexedAt: state.rows[0]?.last?.toISOString() ?? null,
			};
		},
	};
}
