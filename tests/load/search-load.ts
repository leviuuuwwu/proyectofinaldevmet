// Carga reproducible sobre /search (condición 5.8, P4-5) con medición opcional del
// retraso de indexación de escrituras concurrentes (P4-2). Solo HTTP.
//
//   BASE_URL=https://... READER_TOKEN=... RPS=10 DURATION_S=60 npm run load:search
//   ... EDITOR_TOKEN=... WRITES=20 npm run load:search      # además mide la frescura
//
// Modelo abierto: se lanza una búsqueda cada 1/RPS s aunque las anteriores no hayan
// terminado (hasta MAX_IN_FLIGHT), para que la latencia observada no frene la carga.
// Imprime un resumen JSON y sale con código 1 si la tasa de error supera MAX_ERROR_RATE.

const env = (name: string, fallback?: string): string => {
	const value = process.env[name] ?? fallback;
	if (value === undefined) throw new Error(`Falta la variable ${name}`);
	return value;
};

const BASE_URL = env("BASE_URL", "http://localhost:8080");
const READER_TOKEN = env("READER_TOKEN", "dev-reader-token");
const EDITOR_TOKEN = process.env.EDITOR_TOKEN;
const RPS = Number(env("RPS", "10"));
const DURATION_S = Number(env("DURATION_S", "60"));
const WRITES = Number(env("WRITES", "0"));
const MAX_IN_FLIGHT = Number(env("MAX_IN_FLIGHT", "50"));
const MAX_ERROR_RATE = Number(env("MAX_ERROR_RATE", "0.01"));
const CATEGORY = env("CATEGORY", "load-test");

// Consultas fijas: mezclan texto, filtros, orden y paginación (ESC4-03/04).
const QUERIES = [
	"q=respaldo",
	"q=kubernetes&sort=date",
	"q=postgres&pageSize=50",
	"tags=postgres",
	"q=respaldo&page=2&pageSize=10",
	"sort=date&pageSize=20",
];

const percentile = (sorted: number[], p: number): number | null =>
	sorted.length === 0
		? null
		: (sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null);

const round = (ms: number | null) => (ms === null ? null : Math.round(ms * 10) / 10);

const summarize = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: round(percentile(sorted, 50)),
		p95: round(percentile(sorted, 95)),
		p99: round(percentile(sorted, 99)),
		max: round(sorted.at(-1) ?? null),
	};
};

const latencies: number[] = [];
const statusClasses: Record<string, number> = {};
let networkErrors = 0;
let inFlight = 0;
let skipped = 0;

async function searchOnce(i: number): Promise<void> {
	const query = QUERIES[i % QUERIES.length];
	const started = performance.now();
	try {
		const res = await fetch(`${BASE_URL}/search?${query}`, {
			headers: { authorization: `Bearer ${READER_TOKEN}` },
			signal: AbortSignal.timeout(10_000),
		});
		await res.arrayBuffer();
		latencies.push(performance.now() - started);
		const cls = `${Math.floor(res.status / 100)}xx`;
		statusClasses[cls] = (statusClasses[cls] ?? 0) + 1;
	} catch {
		networkErrors++;
	}
}

// Escribe un documento y mide cuánto tarda en reportarse "indexed" (frescura).
async function writeAndMeasure(i: number): Promise<number | null> {
	const headers = {
		authorization: `Bearer ${EDITOR_TOKEN}`,
		"content-type": "application/json",
	};
	const started = performance.now();
	const res = await fetch(`${BASE_URL}/documents`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			title: `Carga ${i} respaldo`,
			description: "Documento ficticio creado por la prueba de carga",
			tags: ["load-test"],
			category: CATEGORY,
			date: new Date().toISOString(),
			status: "published",
		}),
	});
	if (res.status !== 201) return null;
	const { id } = (await res.json()) as { id: string };
	const deadline = started + 120_000;
	while (performance.now() < deadline) {
		const status = await fetch(`${BASE_URL}/documents/${id}/index-status`, {
			headers,
		});
		const body = (await status.json()) as { state: string };
		if (body.state === "indexed") return performance.now() - started;
		if (body.state === "failed") return null;
		await new Promise((r) => setTimeout(r, 100));
	}
	return null;
}

const total = Math.round(RPS * DURATION_S);
const pending: Promise<void>[] = [];
const startedAt = performance.now();

const writeLags: Promise<number | null>[] = [];
const writeEvery = WRITES > 0 && EDITOR_TOKEN ? total / WRITES : Number.POSITIVE_INFINITY;

for (let i = 0; i < total; i++) {
	const due = startedAt + (i * 1000) / RPS;
	const wait = due - performance.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	if (writeLags.length < WRITES && i >= writeLags.length * writeEvery) {
		writeLags.push(writeAndMeasure(writeLags.length));
	}
	if (inFlight >= MAX_IN_FLIGHT) {
		skipped++;
		continue;
	}
	inFlight++;
	pending.push(searchOnce(i).finally(() => inFlight--));
}
await Promise.all(pending);
const lags = (await Promise.all(writeLags)).filter((v): v is number => v !== null);
const elapsedS = (performance.now() - startedAt) / 1000;

const requests = latencies.length + networkErrors;
const errors = (statusClasses["5xx"] ?? 0) + networkErrors;
const errorRate = requests === 0 ? 1 : errors / requests;

const summary = {
	target: { baseUrl: BASE_URL, rps: RPS, durationS: DURATION_S, writes: WRITES },
	searches: {
		sent: requests,
		skippedByInFlightLimit: skipped,
		achievedRps: Math.round((requests / elapsedS) * 10) / 10,
		statusClasses,
		networkErrors,
		errorRate: Math.round(errorRate * 10000) / 10000,
		latencyMs: summarize(latencies),
	},
	indexFreshnessMs:
		WRITES > 0
			? { ...summarize(lags), notIndexed: writeLags.length - lags.length }
			: null,
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = errorRate > MAX_ERROR_RATE ? 1 : 0;
