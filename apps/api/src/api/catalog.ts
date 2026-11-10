// Catalog writes (ESC4-01, ESC4-02). Every write updates `documents` and enqueues an
// outbox event in the SAME transaction; the search index is never written here.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "../shared/db.ts";
import { sendProblem } from "../shared/problem.ts";
import { currentTraceparent, inSpan } from "../shared/tracing.ts";
import { type Client, withTransaction } from "../shared/tx.ts";

export type DocumentStatus = "draft" | "published" | "unpublished";
export type OutboxOp = "upsert" | "delete";

export interface DocumentInput {
	title: string;
	description: string;
	tags: string[];
	category: string;
	date: string;
	status: "draft" | "published";
}

export interface DocumentRow {
	id: string;
	title: string;
	description: string;
	tags: string[];
	category: string;
	date: Date;
	status: DocumentStatus;
	version: number;
	created_at: Date;
	updated_at: Date;
}

type IdParams = { Params: { id: string } };

export function parseIfMatch(header: string | undefined): number | null {
	const match = /^"?([1-9][0-9]{0,9})"?$/.exec(header?.trim() ?? "");
	const version = match ? Number(match[1]) : Number.NaN;
	return Number.isSafeInteger(version) && version <= 2_147_483_647
		? version
		: null;
}

export function opForStatus(status: DocumentStatus): OutboxOp {
	return status === "published" ? "upsert" : "delete";
}

export function toDocumentDto(row: DocumentRow) {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		tags: row.tags,
		category: row.category,
		date: row.date.toISOString(),
		status: row.status,
		version: row.version,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
	};
}

const notFound = (reply: FastifyReply) =>
	sendProblem(reply, 404, { type: "/problems/not-found", title: "Not found" });

const accepted = (reply: FastifyReply, row: DocumentRow) =>
	reply
		.header("etag", `"${row.version}"`)
		.send({ id: row.id, version: row.version, indexState: "pending" });

async function enqueue(
	client: Client,
	request: FastifyRequest,
	row: DocumentRow,
): Promise<void> {
	const op = opForStatus(row.status);
	await inSpan(
		"outbox.enqueue",
		{
			attributes: { "document.id": row.id, "document.version": row.version },
		},
		async () => {
			await client.query(
				"INSERT INTO outbox (doc_id, version, op, traceparent) VALUES ($1, $2, $3, $4)",
				[row.id, row.version, op, currentTraceparent()],
			);
		},
	);
	request.log.debug(
		{
			event: "outbox.enqueued",
			outcome: "success",
			docId: row.id,
			version: row.version,
			op,
		},
		"outbox event enqueued",
	);
}

function logWrite(request: FastifyRequest, op: string, row: DocumentRow) {
	request.log.info(
		{
			event: "catalog.write",
			outcome: "success",
			op,
			docId: row.id,
			version: row.version,
			status: row.status,
		},
		"catalog write committed",
	);
}

// Runs a catalog write inside the `catalog.write` span and one transaction.
function write<T>(
	pool: Pool,
	op: string,
	fn: (client: Client) => Promise<T>,
): Promise<T> {
	return inSpan(
		"catalog.write",
		{ attributes: { "catalog.op": op } },
		async (span) => {
			const result = await withTransaction(pool, fn);
			const row = (result as { row?: DocumentRow } | undefined)?.row;
			if (row) {
				span.setAttributes({
					"document.id": row.id,
					"document.version": row.version,
				});
			}
			return result;
		},
	);
}

export function catalogHandlers(pool: Pool) {
	return {
		async create(
			request: FastifyRequest<{ Body: DocumentInput }>,
			reply: FastifyReply,
		) {
			const doc = request.body;
			const { row } = await write(pool, "create", async (client) => {
				const { rows } = await client.query<DocumentRow>(
					`INSERT INTO documents (title, description, tags, category, date, status)
					 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
					[
						doc.title,
						doc.description,
						doc.tags,
						doc.category,
						doc.date,
						doc.status,
					],
				);
				const row = rows[0] as DocumentRow;
				await enqueue(client, request, row);
				return { row };
			});
			logWrite(request, "create", row);
			reply.code(201).header("location", `/documents/${row.id}`);
			return accepted(reply, row);
		},

		async get(request: FastifyRequest<IdParams>, reply: FastifyReply) {
			const { rows } = await pool.query<DocumentRow>(
				"SELECT * FROM documents WHERE id = $1",
				[request.params.id],
			);
			const row = rows[0];
			if (!row) return notFound(reply);
			return reply.header("etag", `"${row.version}"`).send(toDocumentDto(row));
		},

		async update(
			request: FastifyRequest<
				IdParams & { Body: DocumentInput; Headers: { "if-match": string } }
			>,
			reply: FastifyReply,
		) {
			const expected = parseIfMatch(request.headers["if-match"]);
			if (expected === null) {
				return sendProblem(reply, 400, {
					type: "/problems/validation",
					title: "Invalid request",
					detail: "If-Match must be a document version",
				});
			}
			const doc = request.body;
			const result = await write(pool, "update", async (client) => {
				const { rows } = await client.query<DocumentRow>(
					`UPDATE documents
					 SET title = $3, description = $4, tags = $5, category = $6, date = $7,
					     status = $8, version = version + 1, updated_at = now()
					 WHERE id = $1 AND version = $2 RETURNING *`,
					[
						request.params.id,
						expected,
						doc.title,
						doc.description,
						doc.tags,
						doc.category,
						doc.date,
						doc.status,
					],
				);
				const row = rows[0];
				if (row) {
					await enqueue(client, request, row);
					return { row };
				}
				const current = await client.query<{ version: number }>(
					"SELECT version FROM documents WHERE id = $1",
					[request.params.id],
				);
				return { currentVersion: current.rows[0]?.version ?? null };
			});
			if ("row" in result) {
				logWrite(request, "update", result.row);
				return accepted(reply, result.row);
			}
			if (result.currentVersion === null) return notFound(reply);
			return sendProblem(reply, 409, {
				type: "/problems/version-conflict",
				title: "Version conflict",
				detail: `Expected version ${expected} but current is ${result.currentVersion}`,
			});
		},

		async unpublish(request: FastifyRequest<IdParams>, reply: FastifyReply) {
			const result = await write(pool, "unpublish", async (client) => {
				const { rows } = await client.query<DocumentRow>(
					"SELECT * FROM documents WHERE id = $1 FOR UPDATE",
					[request.params.id],
				);
				const current = rows[0];
				if (!current) return null;
				// Idempotent: already unpublished → same version, no new event.
				if (current.status === "unpublished")
					return { row: current, changed: false };
				const updated = await client.query<DocumentRow>(
					`UPDATE documents SET status = 'unpublished', version = version + 1,
					     updated_at = now()
					 WHERE id = $1 RETURNING *`,
					[request.params.id],
				);
				const row = updated.rows[0] as DocumentRow;
				await enqueue(client, request, row);
				return { row, changed: true };
			});
			if (!result) return notFound(reply);
			if (result.changed) logWrite(request, "unpublish", result.row);
			return accepted(reply, result.row);
		},
	};
}
