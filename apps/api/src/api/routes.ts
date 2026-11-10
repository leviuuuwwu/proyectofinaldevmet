// Contract routes. Auth and request validation are real; handlers are stubs (501)
// until the business logic is implemented.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../shared/auth.ts";
import type { AuthToken } from "../shared/config.ts";
import { sendProblem } from "../shared/problem.ts";
import {
	documentIdParams,
	documentInput,
	ifMatchHeaders,
	jobIdParams,
	searchQuery,
} from "./schemas.ts";

const notImplemented = async (_request: FastifyRequest, reply: FastifyReply) =>
	sendProblem(reply, 501, {
		type: "/problems/not-implemented",
		title: "Not implemented",
	});

export function registerContractRoutes(
	app: FastifyInstance,
	tokens: readonly AuthToken[],
): void {
	const reader = { onRequest: requireRole("reader", tokens) };
	const editor = { onRequest: requireRole("editor", tokens) };
	const admin = { onRequest: requireRole("admin", tokens) };

	app.post(
		"/documents",
		{ ...editor, schema: { body: documentInput } },
		notImplemented,
	);
	app.get(
		"/documents/:id",
		{ ...editor, schema: { params: documentIdParams } },
		notImplemented,
	);
	app.put(
		"/documents/:id",
		{
			...editor,
			schema: {
				params: documentIdParams,
				headers: ifMatchHeaders,
				body: documentInput,
			},
		},
		notImplemented,
	);
	app.post(
		"/documents/:id/unpublish",
		{ ...editor, schema: { params: documentIdParams } },
		notImplemented,
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
