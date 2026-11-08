// OpenTelemetry tracing. Must be imported (dynamically) before fastify and pg are
// loaded, so the ESM hook can patch them.
import { register } from "node:module";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { Config } from "./config.ts";
import { buildInfo } from "./version.ts";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

export function startTelemetry(config: Config): () => Promise<void> {
	// Without an endpoint spans are still created (traceId/spanId in logs) but not exported.
	const provider = new NodeTracerProvider({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: config.otelServiceName,
			[ATTR_SERVICE_VERSION]: buildInfo.version,
			"deployment.environment.name": config.appEnv,
		}),
		spanProcessors: config.otelEndpoint
			? [new BatchSpanProcessor(new OTLPTraceExporter())]
			: [],
	});
	provider.register();

	registerInstrumentations({
		instrumentations: [
			new HttpInstrumentation({
				ignoreIncomingRequestHook: (req) =>
					req.url === "/healthz" ||
					req.url === "/readyz" ||
					req.url === "/metrics",
			}),
			new PgInstrumentation(),
			new FastifyOtelInstrumentation({ registerOnInitialization: true }),
		],
	});

	return () => provider.shutdown();
}
