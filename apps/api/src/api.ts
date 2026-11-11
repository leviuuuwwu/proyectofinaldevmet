// HTTP API entrypoint. Telemetry is loaded before fastify/pg (dynamic imports).
import { loadConfigOrExit } from "./shared/bootstrap.ts";

const { config, logger } = loadConfigOrExit("api");
const { startTelemetry } = await import("./shared/telemetry.ts");
const stopTelemetry = startTelemetry(config);
const { createPool } = await import("./shared/db.ts");
const { buildApi } = await import("./api/server.ts");

const pool = createPool(config, logger);
const app = buildApi({ config, logger, pool });

const shutdown = async (signal: string) => {
	logger.info({ event: "process.stopping", signal }, "shutting down");
	await app.close();
	await pool.end();
	await stopTelemetry();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });

const { failInterruptedJobs } = await import("./api/reindex.ts");
failInterruptedJobs(pool).then(
	(count) =>
		count > 0 &&
		logger.warn(
			{ event: "reindex.finished", outcome: "failure", interrupted: count },
			"marked interrupted rebuilds as failed",
		),
	(err) =>
		logger.warn(
			{ event: "reindex.finished", outcome: "failure", err },
			"could not check interrupted rebuilds",
		),
);
