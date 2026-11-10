// Contract routes (docs/contracts/openapi.yaml): role per route and request schemas.
import type { FastifyInstance } from "fastify";
import { requireRole } from "../shared/auth.ts";
import type { AuthToken } from "../shared/config.ts";
import type { Pool } from "../shared/db.ts";
import type { Logger } from "../shared/logger.ts";
import type { ApiMetrics } from "../shared/metrics.ts";
import { catalogHandlers, type DocumentInput } from "./catalog.ts";
import { indexingHandlers } from "./indexing.ts";
import { reindexHandlers } from "./reindex.ts";
import {
	documentIdParams,
	documentInput,
	ifMatchHeaders,
	jobIdParams,
	searchQuery,
} from "./schemas.ts";
import { type SearchParams, searchHandler } from "./search.ts";

export interface RouteDeps {
	pool: Pool;
	logger: Logger;
	metrics: ApiMetrics;
	tokens: readonly AuthToken[];
}

type IdParams = { Params: { id: string } };

export function registerContractRoutes(
	app: FastifyInstance,
	deps: RouteDeps,
): void {
	const reader = { onRequest: requireRole("reader", deps.tokens) };
	const editor = { onRequest: requireRole("editor", deps.tokens) };
	const admin = { onRequest: requireRole("admin", deps.tokens) };
	const catalog = catalogHandlers(deps.pool);
	const indexing = indexingHandlers(deps.pool);
	const reindex = reindexHandlers(deps);

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
	app.get<IdParams>(
		"/documents/:id/index-status",
		{ ...editor, schema: { params: documentIdParams } },
		indexing.documentStatus,
	);
	app.get<{ Querystring: SearchParams }>(
		"/search",
		{ ...reader, schema: { querystring: searchQuery } },
		searchHandler(deps.pool),
	);
	app.get("/index/status", editor, indexing.globalStatus);
	app.post("/admin/reindex", admin, reindex.start);
	app.get<{ Params: { jobId: string } }>(
		"/admin/reindex/:jobId",
		{ ...admin, schema: { params: jobIdParams } },
		reindex.get,
	);
}
