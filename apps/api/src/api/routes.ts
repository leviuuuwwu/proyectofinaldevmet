// Contract routes (docs/contracts/openapi.yaml). Routes without business logic yet
// answer 501 problem+json.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../shared/auth.ts";
import type { AuthToken } from "../shared/config.ts";
import type { Pool } from "../shared/db.ts";
import { sendProblem } from "../shared/problem.ts";
import { catalogHandlers, type DocumentInput } from "./catalog.ts";
import {
	documentIdParams,
	documentInput,
	ifMatchHeaders,
	jobIdParams,
	searchQuery,
} from "./schemas.ts";

export interface RouteDeps {
	pool: Pool;
	tokens: readonly AuthToken[];
}

type IdParams = { Params: { id: string } };

const notImplemented = async (_request: FastifyRequest, reply: FastifyReply) =>
	sendProblem(reply, 501, {
		type: "/problems/not-implemented",
		title: "Not implemented",
	});

export function registerContractRoutes(
	app: FastifyInstance,
	deps: RouteDeps,
): void {
	const reader = { onRequest: requireRole("reader", deps.tokens) };
	const editor = { onRequest: requireRole("editor", deps.tokens) };
	const admin = { onRequest: requireRole("admin", deps.tokens) };
	const catalog = catalogHandlers(deps.pool);

	app.post<{ Body: DocumentInput }>(
		"/documents",
		{ ...editor, schema: { body: documentInput } },
		catalog.create,
	);
	app.get<IdParams>(
		"/documents/:id",
		{ ...editor, schema: { params: documentIdParams } },
		catalog.get,
	);
	app.put<IdParams & { Body: DocumentInput; Headers: { "if-match": string } }>(
		"/documents/:id",
		{
			...editor,
			schema: {
				params: documentIdParams,
				headers: ifMatchHeaders,
				body: documentInput,
			},
		},
		catalog.update,
	);
	app.post<IdParams>(
		"/documents/:id/unpublish",
		{ ...editor, schema: { params: documentIdParams } },
		catalog.unpublish,
	);
	app.get(
		"/documents/:id/index-status",
		{ ...editor, schema: { params: documentIdParams } },
		notImplemented,
	);
	app.get(
		"/search",
		{ ...reader, schema: { querystring: searchQuery } },
		notImplemented,
	);
	app.get("/index/status", editor, notImplemented);
	app.post("/admin/reindex", admin, notImplemented);
	app.get(
		"/admin/reindex/:jobId",
		{ ...admin, schema: { params: jobIdParams } },
		notImplemented,
	);
}
