// Applies outbox events to the search index (ESC4-05, ESC4-06, ESC4-09).
// Idempotent: an event is applied only if its version is newer than the indexed one,
// and it always applies the CURRENT catalog state, so duplicates and out-of-order
// events converge. Errors are recorded (attempts, last_error), never dropped.
import type { DocumentRow } from "../api/catalog.ts";
import type { Config } from "../shared/config.ts";
import type { Pool } from "../shared/db.ts";
import { INDEX_LOCK } from "../shared/locks.ts";
import type { Logger } from "../shared/logger.ts";
import type { IndexerMetrics } from "../shared/metrics.ts";
import { inSpan, linkFrom } from "../shared/tracing.ts";
import { type Client, withTransaction } from "../shared/tx.ts";

export interface OutboxEvent {
	id: string;
	doc_id: string;
	version: number;
	op: "upsert" | "delete";
	traceparent: string | null;
	created_at: Date;
	attempts: number;
}

export type EventResult = "applied" | "stale_skipped" | "error";

export interface IndexerDeps {
	pool: Pool;
	config: Config;
	logger: Logger;
	metrics: IndexerMetrics;
}

export function decide(
	eventVersion: number,
	indexedVersion: number,
): "apply" | "stale_skipped" {
	return eventVersion <= indexedVersion ? "stale_skipped" : "apply";
}

// One batch in one transaction. Returns how many events were taken and whether a
// rebuild currently holds the index lock.
export async function processBatch(
	deps: IndexerDeps,
): Promise<{ processed: number; blocked: boolean }> {
	const { batchSize, maxAttempts } = deps.config.indexer;
	return withTransaction(deps.pool, async (client) => {
		const lock = await client.query<{ ok: boolean }>(
			"SELECT pg_try_advisory_xact_lock_shared($1) AS ok",
			[INDEX_LOCK],
		);
		if (!lock.rows[0]?.ok) return { processed: 0, blocked: true };

		const { rows: events } = await client.query<OutboxEvent>(
			`SELECT id, doc_id, version, op, traceparent, created_at, attempts
			 FROM outbox
			 WHERE processed_at IS NULL AND attempts < $1
			 ORDER BY id
			 LIMIT $2
			 FOR UPDATE SKIP LOCKED`,
			[maxAttempts, batchSize],
		);
		if (events.length === 0) return { processed: 0, blocked: false };

		await inSpan(
			"indexer.process",
			{ root: true, attributes: { "indexer.batch_size": events.length } },
			async (span) => {
				span.addLinks(
					events.flatMap((e) => {
						const link = linkFrom(e.traceparent);
						return link ? [link] : [];
					}),
				);
				const counts = { applied: 0, stale_skipped: 0, error: 0 };
				for (const event of events) {
					const result = await processEvent(client, event, deps);
					counts[result]++;
					deps.metrics.eventsProcessed.inc({ result });
				}
				span.setAttributes({
					"indexer.applied": counts.applied,
					"indexer.stale_skipped": counts.stale_skipped,
					"indexer.errors": counts.error,
				});
			},
		);
		return { processed: events.length, blocked: false };
	});
}

async function processEvent(
	client: Client,
	event: OutboxEvent,
	deps: IndexerDeps,
): Promise<EventResult> {
	const started = performance.now();
	// traceId of the API request that wrote the event: correlates logs across components.
	const linkedTraceId = event.traceparent?.split("-")[1];
	await client.query("SAVEPOINT outbox_event");
	try {
		const result = await applyEvent(client, event, deps.config);
		await client.query("RELEASE SAVEPOINT outbox_event");
		const fields = {
			docId: event.doc_id,
			version: event.version,
			linkedTraceId,
			durationMs: Math.round(performance.now() - started),
		};
		if (result === "applied") {
			deps.metrics.indexLag.observe(
				{ op: event.op },
				(Date.now() - event.created_at.getTime()) / 1000,
			);
			deps.logger.info(
				{ event: "index.applied", outcome: "success", ...fields },
				"event applied to index",
			);
		} else {
			deps.logger.debug(
				{ event: "index.stale_skipped", outcome: "skipped", ...fields },
				"stale event skipped",
			);
		}
		return result;
	} catch (err) {
		await client.query("ROLLBACK TO SAVEPOINT outbox_event");
		const message = String((err as Error).message ?? err).slice(0, 500);
		await client.query(
			"UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1",
			[event.id, message],
		);
		await client.query(
			`INSERT INTO index_state (doc_id, indexed_version, last_error) VALUES ($1, 0, $2)
			 ON CONFLICT (doc_id) DO UPDATE SET last_error = EXCLUDED.last_error`,
			[event.doc_id, message],
		);
		deps.logger.error(
			{
				event: "index.failed",
				outcome: "failure",
				docId: event.doc_id,
				version: event.version,
				linkedTraceId,
				attempt: event.attempts + 1,
				maxAttempts: deps.config.indexer.maxAttempts,
				err,
			},
			"failed to apply event",
		);
		return "error";
	}
}

async function applyEvent(
	client: Client,
	event: OutboxEvent,
	config: Config,
): Promise<Exclude<EventResult, "error">> {
	const state = await client.query<{ indexed_version: number }>(
		"SELECT indexed_version FROM index_state WHERE doc_id = $1 FOR UPDATE",
		[event.doc_id],
	);
	const indexedVersion = state.rows[0]?.indexed_version ?? 0;

	if (decide(event.version, indexedVersion) === "stale_skipped") {
		await client.query("UPDATE outbox SET processed_at = now() WHERE id = $1", [
			event.id,
		]);
		return "stale_skipped";
	}

	const { rows } = await client.query<DocumentRow>(
		"SELECT * FROM documents WHERE id = $1",
		[event.doc_id],
	);
	const doc = rows[0] as DocumentRow;
	const fault = config.indexer.faultCategory;
	if (fault !== undefined && doc.category === fault) {
		throw new Error(`fault injected for category '${fault}'`);
	}

	if (doc.status === "published") {
		await client.query(
			`INSERT INTO search_documents (id, version, title, description, tags, category, published_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE SET
			   version = EXCLUDED.version, title = EXCLUDED.title,
			   description = EXCLUDED.description, tags = EXCLUDED.tags,
			   category = EXCLUDED.category, published_at = EXCLUDED.published_at
			 WHERE search_documents.version < EXCLUDED.version`,
			[
				doc.id,
				doc.version,
				doc.title,
				doc.description,
				doc.tags,
				doc.category,
				doc.date,
			],
		);
	} else {
		await client.query("DELETE FROM search_documents WHERE id = $1", [doc.id]);
	}

	await client.query(
		`INSERT INTO index_state (doc_id, indexed_version, indexed_at, last_error)
		 VALUES ($1, $2, now(), NULL)
		 ON CONFLICT (doc_id) DO UPDATE SET
		   indexed_version = GREATEST(index_state.indexed_version, EXCLUDED.indexed_version),
		   indexed_at = now(), last_error = NULL`,
		[doc.id, doc.version],
	);
	await client.query("UPDATE outbox SET processed_at = now() WHERE id = $1", [
		event.id,
	]);
	// Older events that exhausted their attempts are superseded by this state.
	await client.query(
		`UPDATE outbox SET processed_at = now()
		 WHERE doc_id = $1 AND processed_at IS NULL AND version <= $2 AND attempts >= $3`,
		[doc.id, doc.version, config.indexer.maxAttempts],
	);
	return "applied";
}

export async function countPending(pool: Pool): Promise<number> {
	const { rows } = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM outbox WHERE processed_at IS NULL",
	);
	return rows[0]?.n ?? 0;
}
