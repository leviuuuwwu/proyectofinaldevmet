// Metrics of docs/contracts/telemetry.md. Labels must stay low-cardinality:
// never document ids, query text, tokens or users.
import {
	Counter,
	collectDefaultMetrics,
	Gauge,
	Histogram,
	Registry,
} from "prom-client";
import { buildInfo } from "./version.ts";

export function createRegistry(component: "api" | "indexer"): Registry {
	const registry = new Registry();
	collectDefaultMetrics({ register: registry });
	new Gauge({
		name: "app_build_info",
		help: "Running build; always 1",
		labelNames: ["version", "commit", "component"],
		registers: [registry],
	}).set(
		{ version: buildInfo.version, commit: buildInfo.commit, component },
		1,
	);
	return registry;
}

export function createApiMetrics(registry: Registry) {
	const registers = [registry];
	return {
		httpDuration: new Histogram({
			name: "http_server_request_duration_seconds",
			help: "HTTP request duration by route template",
			labelNames: ["route", "method", "status_class"],
			buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
			registers,
		}),
		searchRequests: new Counter({
			name: "search_requests_total",
			help: "Search requests by result",
			labelNames: ["result"],
			registers,
		}),
		catalogWrites: new Counter({
			name: "catalog_writes_total",
			help: "Catalog writes by operation and result",
			labelNames: ["op", "result"],
			registers,
		}),
		reindexRuns: new Counter({
			name: "reindex_runs_total",
			help: "Finished index rebuilds by result",
			labelNames: ["result"],
			registers,
		}),
		reindexDuration: new Histogram({
			name: "reindex_duration_seconds",
			help: "Index rebuild duration",
			labelNames: ["result"],
			buckets: [1, 2, 5, 10, 30, 60, 120, 300, 600],
			registers,
		}),
	};
}

export function createIndexerMetrics(registry: Registry) {
	const registers = [registry];
	return {
		outboxPending: new Gauge({
			name: "index_outbox_pending",
			help: "Unprocessed outbox rows",
			registers,
		}),
		indexLag: new Histogram({
			name: "index_lag_seconds",
			help: "Time from catalog commit to applied in the search index",
			labelNames: ["op"],
			buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
			registers,
		}),
		eventsProcessed: new Counter({
			name: "index_events_processed_total",
			help: "Outbox events processed by result",
			labelNames: ["result"],
			registers,
		}),
	};
}

export type ApiMetrics = ReturnType<typeof createApiMetrics>;
export type IndexerMetrics = ReturnType<typeof createIndexerMetrics>;
