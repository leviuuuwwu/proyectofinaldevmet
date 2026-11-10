// Administrative rebuild of the search index from the catalog (ESC4-07, ESC4-08).
// The new index is built in search_documents_shadow and swapped in atomically;
// `documents` is only read, and searches keep reading the old table meanwhile.
import { type Link, trace } from "@opentelemetry/api";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "../shared/db.ts";
import { INDEX_LOCK } from "../shared/locks.ts";
import type { Logger } from "../shared/logger.ts";
import type { ApiMetrics } from "../shared/metrics.ts";
import { sendProblem } from "../shared/problem.ts";
import { inSpan } from "../shared/tracing.ts";

export interface ReindexDeps {
	pool: Pool;
	logger: Logger;
	metrics: ApiMetrics;
}

interface JobRow {
	id: string;
	state: string;
	started_at: Date | null;
	finished_at: Date | null;
	documents: number | null;
	error: string | null;
}

const SHADOW_DDL = `
	CREATE TABLE search_documents_shadow (
		id uuid PRIMARY KEY,
		version integer NOT NULL,
		title text NOT NULL,
		description text NOT NULL,
		tags text[] NOT NULL,
		category text NOT NULL,
		published_at timestamptz NOT NULL,
		tsv tsvector GENERATED ALWAYS AS (
			setweight(to_tsvector('spanish', title), 'A') ||
			setweight(to_tsvector('spanish', description), 'B')
		) STORED
	)`;

// Index names must match 001_init.sql after the swap.
const INDEXES: [name: string, definition: string][] = [
	["search_documents_tsv_idx", "USING gin (tsv)"],
	["search_documents_tags_idx", "USING gin (tags)"],
	["search_documents_category_idx", "(category)"],
	["search_documents_order_idx", "(published_at DESC, id)"],
];

// Returns the number of documents in the new index.
export async function rebuildIndex(pool: Pool, jobId: string): Promise<number> {
	const client = await pool.connect();
	try {
		// Session-level exclusive lock BEFORE the snapshot: waits for in-flight indexer
		// batches (shared lock) so the snapshot already includes their commits.
		await client.query("SELECT pg_advisory_lock($1)", [INDEX_LOCK]);
		try {
			// 'running' implies the lock is held (see failInterruptedJobs).
			await client.query(
				"UPDATE reindex_jobs SET state = 'running', started_at = now() WHERE id = $1",
				[jobId],
			);
			await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
			await client.query("DROP TABLE IF EXISTS search_documents_shadow");
			await client.query(SHADOW_DDL);
			const inserted = await client.query(
				`INSERT INTO search_documents_shadow
				   (id, version, title, description, tags, category, published_at)
				 SELECT id, version, title, description, tags, category, date
				 FROM documents WHERE status = 'published'`,
			);
			for (const [name, definition] of INDEXES) {
				await client.query(
					`CREATE INDEX ${name.replace("search_documents", "search_documents_shadow")}
					 ON search_documents_shadow ${definition}`,
				);
			}
			// Every catalog version in the snapshot is now reflected in the index.
			await client.query(
				`INSERT INTO index_state (doc_id, indexed_version, indexed_at, last_error)
				 SELECT id, version, now(), NULL FROM documents
				 ON CONFLICT (doc_id) DO UPDATE SET
				   indexed_version = EXCLUDED.indexed_version, indexed_at = now(), last_error = NULL`,
			);
			// Pending events up to those versions are covered by the rebuild; newer ones
			// (committed after the snapshot) stay pending for the indexer.
			await client.query(
				`UPDATE outbox o SET processed_at = now()
				 FROM documents d
				 WHERE o.doc_id = d.id AND o.processed_at IS NULL AND o.version <= d.version`,
			);
			await client.query(
				"ALTER TABLE search_documents RENAME TO search_documents_old",
			);
			await client.query(
				"ALTER TABLE search_documents_shadow RENAME TO search_documents",
			);
			await client.query("DROP TABLE search_documents_old");
			await client.query(
				"ALTER TABLE search_documents RENAME CONSTRAINT search_documents_shadow_pkey TO search_documents_pkey",
			);
			for (const [name] of INDEXES) {
				await client.query(
					`ALTER INDEX ${name.replace("search_documents", "search_documents_shadow")} RENAME TO ${name}`,
				);
			}
			await client.query("COMMIT");
			return inserted.rowCount ?? 0;
		} catch (err) {
			await client.query("ROLLBACK").catch(() => {});
			throw err;
		} finally {
			await client.query("SELECT pg_advisory_unlock($1)", [INDEX_LOCK]);
		}
	} finally {
		client.release();
	}
}

async function runReindex(
	jobId: string,
	deps: ReindexDeps,
	link: Link | null,
): Promise<void> {
	await inSpan(
		"reindex.run",
		{
			root: true,
			links: link ? [link] : [],
			attributes: { "reindex.job_id": jobId },
		},
		async (span) => {
			const started = performance.now();
			deps.logger.info(
				{ event: "reindex.started", outcome: "success", jobId },
				"index rebuild started",
			);
			let result: "succeeded" | "failed" = "succeeded";
			try {
				const documents = await rebuildIndex(deps.pool, jobId);
				await deps.pool.query(
					`UPDATE reindex_jobs SET state = 'succeeded', finished_at = now(), documents = $2
					 WHERE id = $1`,
					[jobId, documents],
				);
				span.setAttribute("reindex.documents", documents);
				deps.logger.info(
					{
						event: "reindex.finished",
						outcome: "success",
						jobId,
						documents,
						durationMs: Math.round(performance.now() - started),
					},
					"index rebuild finished",
				);
			} catch (err) {
				result = "failed";
				await deps.pool
					.query(
						`UPDATE reindex_jobs SET state = 'failed', finished_at = now(), error = $2
						 WHERE id = $1`,
						[jobId, String((err as Error).message).slice(0, 500)],
					)
					.catch(() => {});
				deps.logger.error(
					{
						event: "reindex.finished",
						outcome: "failure",
						jobId,
						durationMs: Math.round(performance.now() - started),
						err,
					},
					"index rebuild failed",
				);
			} finally {
				const seconds = (performance.now() - started) / 1000;
				deps.metrics.reindexRuns.inc({ result });
				deps.metrics.reindexDuration.observe({ result }, seconds);
			}
		},
	);
}

// A job left 'running' (or 'queued' for over a minute) while nobody holds the index
// lock belongs to a process that died: mark it failed so a new rebuild can start.
export async function failInterruptedJobs(pool: Pool): Promise<number> {
	const client = await pool.connect();
	try {
		const lock = await client.query<{ ok: boolean }>(
			"SELECT pg_try_advisory_lock($1) AS ok",
			[INDEX_LOCK],
		);
		if (!lock.rows[0]?.ok) return 0;
		try {
			const { rowCount } = await client.query(
				`UPDATE reindex_jobs SET state = 'failed', finished_at = now(), error = 'interrupted'
				 WHERE state = 'running'
				    OR (state = 'queued' AND created_at < now() - interval '1 minute')`,
			);
			return rowCount ?? 0;
		} finally {
			await client.query("SELECT pg_advisory_unlock($1)", [INDEX_LOCK]);
		}
	} finally {
		client.release();
	}
}

export function reindexHandlers(deps: ReindexDeps) {
	return {
		async start(request: FastifyRequest, reply: FastifyReply) {
			let jobId: string;
			try {
				const { rows } = await deps.pool.query<{ id: string }>(
					"INSERT INTO reindex_jobs (state, requested_by) VALUES ('queued', $1) RETURNING id",
					[request.principal?.sub ?? "unknown"],
				);
				jobId = (rows[0] as { id: string }).id;
			} catch (err) {
				if ((err as { code?: string }).code !== "23505") throw err;
				const active = await deps.pool.query<{ id: string }>(
					"SELECT id FROM reindex_jobs WHERE state IN ('queued', 'running') LIMIT 1",
				);
				return sendProblem(reply, 409, {
					type: "/problems/reindex-in-progress",
					title: "Reindex already running",
					detail: `Job ${active.rows[0]?.id ?? "unknown"} is running`,
				});
			}
			const parent = trace.getActiveSpan()?.spanContext();
			void runReindex(jobId, deps, parent ? { context: parent } : null);
			return reply
				.code(202)
				.header("location", `/admin/reindex/${jobId}`)
				.send({ jobId });
		},

		async get(
			request: FastifyRequest<{ Params: { jobId: string } }>,
			reply: FastifyReply,
		) {
			const { rows } = await deps.pool.query<JobRow>(
				"SELECT id, state, started_at, finished_at, documents, error FROM reindex_jobs WHERE id = $1",
				[request.params.jobId],
			);
			const job = rows[0];
			if (!job) {
				return sendProblem(reply, 404, {
					type: "/problems/not-found",
					title: "Not found",
				});
			}
			return {
				jobId: job.id,
				state: job.state,
				startedAt: job.started_at?.toISOString() ?? null,
				finishedAt: job.finished_at?.toISOString() ?? null,
				documents: job.documents,
				error: job.error,
			};
		},
	};
}
