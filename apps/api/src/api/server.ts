import type { FastifyInstance } from "fastify";
import type { Config } from "../shared/config.ts";
import type { Pool } from "../shared/db.ts";
import { createHttpServer, registerOpsRoutes } from "../shared/http.ts";
import type { Logger } from "../shared/logger.ts";
import {
	type ApiMetrics,
	createApiMetrics,
	createRegistry,
} from "../shared/metrics.ts";
import { registerContractRoutes } from "./routes.ts";

export function buildApi(deps: {
	config: Config;
	logger: Logger;
	pool: Pool;
}): FastifyInstance {
	const app = createHttpServer(deps.logger);
	const registry = createRegistry("api");
	const metrics = createApiMetrics(registry);

	app.addHook("onResponse", (request, reply, done) => {
		observeRequest(metrics, request.routeOptions.url, request.method, reply);
		done();
	});

	registerOpsRoutes(app, { pool: deps.pool, registry, exposeVersion: true });
	registerContractRoutes(app, deps.config.authTokens);
	return app;
}

function observeRequest(
	metrics: ApiMetrics,
	route: string | undefined,
	method: string,
	reply: { statusCode: number; elapsedTime: number },
): void {
	const status = reply.statusCode;
	metrics.httpDuration.observe(
		{
			route: route ?? "unmatched",
			method,
			status_class: `${Math.floor(status / 100)}xx`,
		},
		reply.elapsedTime / 1000,
	);
	if (route === "/search") {
		const result =
			status >= 500 ? "server_error" : status >= 400 ? "client_error" : "ok";
		metrics.searchRequests.inc({ result });
	}
}
