// Indexer worker entrypoint: health/metrics server on PORT (9090) plus the outbox loop.
import { loadConfigOrExit } from "./shared/bootstrap.ts";

const { config, logger } = loadConfigOrExit("indexer");
const { startTelemetry } = await import("./shared/telemetry.ts");
const stopTelemetry = startTelemetry(config);
const { createPool } = await import("./shared/db.ts");
const { createHttpServer, registerOpsRoutes } = await import(
	"./shared/http.ts"
);
const { createRegistry, createIndexerMetrics } = await import(
	"./shared/metrics.ts"
);
const { startWorker } = await import("./indexer/worker.ts");

const pool = createPool(config);
const registry = createRegistry("indexer");
const metrics = createIndexerMetrics(registry);

const app = createHttpServer(logger);
registerOpsRoutes(app, { pool, registry, exposeVersion: false });

const worker = startWorker({ pool, config, logger, metrics });

const shutdown = async (signal: string) => {
	logger.info({ event: "process.stopping", signal }, "shutting down");
	await worker.stop();
	await app.close();
	await pool.end();
	await stopTelemetry();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });
