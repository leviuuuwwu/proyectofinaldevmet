// Fastify setup shared by the api and the indexer health server:
// correlationId, problem+json errors and ops endpoints.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { Registry } from "prom-client";
import { isDatabaseReachable, type Pool } from "./db.ts";
import type { Logger } from "./logger.ts";
import { registerProblemHandlers, sendProblem } from "./problem.ts";
import { buildInfo } from "./version.ts";

const CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;

export function createHttpServer(logger: Logger): FastifyInstance {
	const app = Fastify({
		loggerInstance: logger,
		requestIdLogLabel: "correlationId",
		genReqId: (req) => {
			const header = req.headers["x-correlation-id"];
			return typeof header === "string" && CORRELATION_ID.test(header)
				? header
				: randomUUID();
		},
		ajv: { customOptions: { removeAdditional: false, allErrors: true } },
	}) as unknown as FastifyInstance;

	// Body-less POSTs (unpublish, reindex) are often sent with a JSON content-type;
	// treat an empty body as absent instead of a 400. Keeps Fastify's safe parser.
	const parseJson = app.getDefaultJsonParser("error", "error");
	app.removeContentTypeParser("application/json");
	app.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		(request, body, done) =>
			body === ""
				? done(null, undefined)
				: parseJson(request, body as string, done),
	);

	app.decorateRequest("principal", null);
	app.addHook("onRequest", (request, reply, done) => {
		reply.header("x-correlation-id", request.id);
		done();
	});
	registerProblemHandlers(app);
	return app;
}

export function registerOpsRoutes(
	app: FastifyInstance,
	deps: { pool: Pool; registry: Registry; exposeVersion: boolean },
): void {
	app.get("/healthz", async () => ({ status: "ok" }));

	app.get("/readyz", async (_request, reply) => {
		if (await isDatabaseReachable(deps.pool)) return { status: "ok" };
		return sendProblem(reply, 503, {
			type: "/problems/not-ready",
			title: "Service not ready",
			detail: "Database is not reachable",
		});
	});

	if (deps.exposeVersion) {
		app.get("/version", async () => buildInfo);
	}

	app.get("/metrics", async (_request, reply) =>
		reply.type(deps.registry.contentType).send(await deps.registry.metrics()),
	);
}
