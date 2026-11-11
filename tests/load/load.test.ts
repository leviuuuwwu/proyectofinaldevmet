// Load test (P4-2, P4-4, P4-5; MET-07): concurrent searches, concurrent writes with indexing
// lag, and a mixed phase with an index rebuild in the middle. HTTP only (ADR 0001).
//
// Thresholds are configurable and are DEFAULT ASSUMPTIONS for a local run, not rubric values;
// adjust them with the LOAD_* variables (see README.md).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
	createRng,
	generateDocument,
} from "../../tools/datagen/src/data.ts";
import {
	BASE_URL,
	http,
	num,
	percentile,
	readCounter,
	runCount,
	runFor,
	type Sample,
	type Step,
	sleep,
	summarize,
	waitDrained,
} from "./lib.ts";

const CFG = {
	seedDocs: num("LOAD_SEED_DOCS", 300),
	searchVus: num("LOAD_SEARCH_VUS", 20),
	searchSeconds: num("LOAD_SEARCH_SECONDS", 10),
	writeVus: num("LOAD_WRITE_VUS", 10),
	writeDocs: num("LOAD_WRITE_DOCS", 300),
	steadyRate: num("LOAD_STEADY_RATE", 10),
	steadySeconds: num("LOAD_STEADY_SECONDS", 10),
	mixedSeconds: num("LOAD_MIXED_SECONDS", 12),
	maxSearchP95Ms: num("LOAD_MAX_SEARCH_P95_MS", 1000),
	maxWriteP95Ms: num("LOAD_MAX_WRITE_P95_MS", 2000),
	maxLagP95S: num("LOAD_MAX_LAG_P95_S", 5),
	drainTimeoutS: num("LOAD_DRAIN_TIMEOUT_S", 60),
};

const runTag = `load${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const rng = createRng(7);
const pick = <T>(list: readonly T[]): T =>
	list[Math.floor(rng() * list.length)] as T;

const WORDS = [
	"respaldo",
	"restauración",
	"incidentes",
	"costos",
	"rendimiento",
	"migración",
	"auditoría",
	"alertas",
	"capacitación",
	"pipeline",
	"clúster",
	"catálogo",
	"monitoreo",
	"versión",
];
const categories = new Set<string>();
const tags = new Set<string>();

const report: Record<string, unknown> = {
	baseUrl: BASE_URL,
	runTag,
	config: CFG,
	startedAt: new Date().toISOString(),
};

interface Owned {
	id: string;
	version: number;
}
const createdIds: string[] = [];

function documentBody() {
	const doc = generateDocument(rng);
	categories.add(doc.category);
	for (const tag of doc.tags) tags.add(tag);
	return { ...doc, tags: [...doc.tags, runTag] };
}

/** Each VU creates documents and updates its own (so If-Match is always current). */
function writeStep(
	owned: Owned[][],
	options: { updates?: boolean } = {},
): Step {
	const updates = options.updates ?? true;
	return async (vu) => {
		const mine = owned[vu] as Owned[];
		const body = documentBody();
		if (updates && mine.length > 0 && rng() < 0.3) {
			const target = pick(mine);
			const res = await http<{ version: number }>(
				"PUT",
				`/documents/${target.id}`,
				"editor",
				body,
				target.version,
			);
			if (res.status === 200) {
				target.version = res.body.version;
				return { ok: true, status: 200, ms: res.ms };
			}
			return { ok: false, status: res.status, ms: res.ms, note: `PUT ${res.status}` };
		}
		const res = await http<{ id: string; version: number }>(
			"POST",
			"/documents",
			"editor",
			body,
		);
		if (res.status === 201) {
			mine.push({ id: res.body.id, version: res.body.version });
			createdIds.push(res.body.id);
			return { ok: true, status: 201, ms: res.ms };
		}
		return { ok: false, status: res.status, ms: res.ms, note: `POST ${res.status}` };
	};
}

interface SearchBody {
	total: number;
	pageSize: number;
	items: { date: string }[];
}

/** A realistic mix of queries; every response is validated, not only its status. */
const searchStep: Step = async () => {
	const word = pick(WORDS);
	const category = pick([...categories]);
	const params = new URLSearchParams();
	let byDate = false;
	let pageSize = 20;
	let unfiltered = false;
	switch (Math.floor(rng() * 5)) {
		case 0:
			params.set("q", word);
			break;
		case 1:
			params.set("q", word);
			params.set("category", category);
			break;
		case 2:
			params.append("tags", pick([...tags]));
			params.set("sort", "date");
			byDate = true;
			break;
		case 3:
			params.set("category", category);
			params.set("sort", "date");
			params.set("page", String(1 + Math.floor(rng() * 5)));
			byDate = true;
			break;
		default:
			unfiltered = true;
			pageSize = 50;
			params.set("pageSize", "50");
			params.set("sort", "date");
			params.set("page", String(1 + Math.floor(rng() * 3)));
			byDate = true;
	}
	const res = await http<SearchBody>("GET", `/search?${params}`, "reader");
	const sample: Sample = { ok: false, status: res.status, ms: res.ms };
	if (res.status !== 200) {
		sample.note = `status ${res.status}`;
		return sample;
	}
	const body = res.body;
	if (typeof body?.total !== "number" || !Array.isArray(body.items)) {
		sample.note = "malformed body";
	} else if (unfiltered && body.total === 0) {
		// The corpus was seeded, so an unfiltered search can never be empty (ESC4-08).
		sample.note = "empty index: total 0";
	} else if (body.items.length > Math.min(pageSize, body.total)) {
		sample.note = "more items than pageSize/total";
	} else if (
		byDate &&
		body.items.some(
			(item, i) => i > 0 && item.date > (body.items[i - 1] as { date: string }).date,
		)
	) {
		sample.note = "date order violated";
	} else {
		sample.ok = true;
	}
	return sample;
};

const line = (name: string, s: ReturnType<typeof summarize>) =>
	`${name}: ${s.requests} req, ${s.errors} errors, ${s.rps} req/s, p50 ${s.p50Ms} ms, p95 ${s.p95Ms} ms, p99 ${s.p99Ms} ms, max ${s.maxMs} ms`;

describe("carga", () => {
	before(async () => {
		// Seed data so searches have something to find. Not measured.
		const owned: Owned[][] = Array.from({ length: 10 }, () => []);
		const seed = await runCount(CFG.seedDocs, 10, writeStep(owned));
		const stats = summarize(seed.samples, seed.seconds);
		assert.equal(stats.errors, 0, `seeding failed: ${JSON.stringify(stats.statuses)}`);
		const drain = await waitDrained(CFG.drainTimeoutS);
		assert.ok(drain.drained, `index did not drain after seeding: ${JSON.stringify(drain)}`);
		report.seed = { documents: CFG.seedDocs, drainSeconds: drain.seconds };
	});

	after(() => {
		report.finishedAt = new Date().toISOString();
		console.log(`LOAD_REPORT ${JSON.stringify(report)}`);
		const file = process.env.LOAD_REPORT_FILE;
		if (file) writeFileSync(file, `${JSON.stringify(report, null, "\t")}\n`);
	});

	it("búsquedas concurrentes: sin errores y latencia dentro del umbral", async (t) => {
		const before = await readCounter("search_requests_total", 'result="ok"');
		const run = await runFor(CFG.searchSeconds, CFG.searchVus, searchStep);
		const after = await readCounter("search_requests_total", 'result="ok"');
		const stats = summarize(run.samples, run.seconds);
		report.search = {
			vus: CFG.searchVus,
			...stats,
			// Informational: the API's own counter should match when nothing else is searching.
			serverSearchOkDelta: before !== null && after !== null ? after - before : null,
		};
		t.diagnostic(line(`search (${CFG.searchVus} VUs)`, stats));

		assert.ok(stats.requests > 0, "no requests were sent");
		assert.equal(
			stats.errors,
			0,
			`search errors: ${JSON.stringify(stats.notes)} statuses: ${JSON.stringify(stats.statuses)}`,
		);
		assert.ok(
			stats.p95Ms <= CFG.maxSearchP95Ms,
			`search p95 ${stats.p95Ms} ms > ${CFG.maxSearchP95Ms} ms`,
		);
	});

	/** Indexing lag as the API reports it: indexedAt - committedAt (both from the database clock). */
	async function measureLag(ids: string[]) {
		const stride = Math.max(1, Math.floor(ids.length / 100));
		const sample = ids.filter((_, i) => i % stride === 0).slice(0, 100);
		const lags: number[] = [];
		await runCount(sample.length, 10, async (_vu, i) => {
			const res = await http<{
				state: string;
				committedAt: string;
				indexedAt: string | null;
			}>("GET", `/documents/${sample[i]}/index-status`, "editor");
			if (
				res.status === 200 &&
				res.body.state === "indexed" &&
				res.body.indexedAt
			) {
				const ms = Date.parse(res.body.indexedAt) - Date.parse(res.body.committedAt);
				lags.push(Math.max(0, ms) / 1000);
			}
			return { ok: res.status === 200, status: res.status, ms: res.ms };
		});
		lags.sort((a, b) => a - b);
		return {
			samples: lags.length,
			p50S: percentile(lags, 50),
			p95S: percentile(lags, 95),
			maxS: lags.at(-1) ?? 0,
		};
	}

	it("ráfaga de escrituras: sin errores, el outbox se vacía y se mide el caudal del indexer", async (t) => {
		const owned: Owned[][] = Array.from({ length: CFG.writeVus }, () => []);
		const firstNew = createdIds.length;
		const run = await runCount(CFG.writeDocs, CFG.writeVus, writeStep(owned));
		const stats = summarize(run.samples, run.seconds);
		const drain = await waitDrained(CFG.drainTimeoutS);
		// Each write enqueues one event, so events / (burst + drain) is the indexer's throughput.
		const eventsPerSecond = Number(
			(CFG.writeDocs / (run.seconds + drain.seconds)).toFixed(1),
		);
		// Informational only: a burst above the indexer's capacity queues, and the lag is the queue.
		const burstLag = await measureLag(createdIds.slice(firstNew));
		report.burst = {
			vus: CFG.writeVus,
			...stats,
			drain,
			indexerEventsPerSecond: eventsPerSecond,
			lag: burstLag,
		};
		t.diagnostic(line(`burst writes (${CFG.writeVus} VUs)`, stats));
		t.diagnostic(
			`burst: outbox drained ${drain.seconds} s after the last write; indexer throughput ~${eventsPerSecond} events/s; queue lag p95 ${burstLag.p95S.toFixed(2)} s (informational)`,
		);

		assert.equal(stats.errors, 0, `write errors: ${JSON.stringify(stats.notes)}`);
		assert.ok(stats.p95Ms <= CFG.maxWriteP95Ms, `write p95 ${stats.p95Ms} ms`);
		assert.ok(drain.drained, `outbox did not drain: ${JSON.stringify(drain)}`);
		assert.ok(burstLag.samples > 0, "no indexed documents to measure lag on");
	});

	it("escrituras a ritmo constante: el retraso de indexación se mantiene acotado", async (t) => {
		// A paced load below the indexer's capacity: here the lag is the real latency, not a queue.
		const total = Math.round(CFG.steadyRate * CFG.steadySeconds);
		const owned: Owned[][] = [[]];
		const step = writeStep(owned, { updates: false });
		const firstNew = createdIds.length;
		const started = performance.now();
		const inflight: Promise<Sample>[] = [];
		for (let i = 0; i < total; i++) {
			const wait = started + (i * 1000) / CFG.steadyRate - performance.now();
			if (wait > 0) await sleep(wait);
			inflight.push(step(0, i));
		}
		const samples = await Promise.all(inflight);
		const stats = summarize(samples, (performance.now() - started) / 1000);
		const drain = await waitDrained(CFG.drainTimeoutS);
		const lag = await measureLag(createdIds.slice(firstNew));
		report.steady = { ratePerSecond: CFG.steadyRate, ...stats, drain, lag };
		t.diagnostic(line(`steady writes (${CFG.steadyRate}/s)`, stats));
		t.diagnostic(
			`steady lag: ${lag.samples} docs, p50 ${lag.p50S.toFixed(2)} s, p95 ${lag.p95S.toFixed(2)} s, max ${lag.maxS.toFixed(2)} s`,
		);

		assert.equal(stats.errors, 0, `write errors: ${JSON.stringify(stats.notes)}`);
		assert.ok(drain.drained, `outbox did not drain: ${JSON.stringify(drain)}`);
		assert.ok(lag.samples > 0, "no indexed documents to measure lag on");
		assert.ok(
			lag.p95S <= CFG.maxLagP95S,
			`index lag p95 ${lag.p95S} s > ${CFG.maxLagP95S} s at ${CFG.steadyRate} writes/s`,
		);
	});

	it("carga mixta con una reconstrucción del índice en medio: sin errores y todo converge", async (t) => {
		const owned: Owned[][] = Array.from({ length: Math.max(1, Math.floor(CFG.writeVus / 2)) }, () => []);
		const reindex = (async () => {
			await sleep(CFG.mixedSeconds * 1000 * 0.4);
			const start = await http<{ jobId: string }>("POST", "/admin/reindex", "admin");
			if (start.status !== 202) return { startStatus: start.status, state: "not-started" };
			const deadline = Date.now() + 60_000;
			for (;;) {
				const job = await http<{ state: string; documents: number | null; error: string | null }>(
					"GET",
					`/admin/reindex/${start.body.jobId}`,
					"admin",
				);
				if (["succeeded", "failed"].includes(job.body?.state)) {
					return { startStatus: 202, state: job.body.state, documents: job.body.documents, error: job.body.error };
				}
				if (Date.now() > deadline) return { startStatus: 202, state: "timeout" };
				await sleep(50);
			}
		})();

		const [searches, writes, rebuilt] = await Promise.all([
			runFor(CFG.mixedSeconds, CFG.searchVus, searchStep),
			runFor(CFG.mixedSeconds, owned.length, writeStep(owned)),
			reindex,
		]);
		const searchStats = summarize(searches.samples, searches.seconds);
		const writeStats = summarize(writes.samples, writes.seconds);
		const drain = await waitDrained(CFG.drainTimeoutS);
		report.mixed = { search: searchStats, writes: writeStats, reindex: rebuilt, drain };
		t.diagnostic(line("mixed search", searchStats));
		t.diagnostic(line("mixed writes", writeStats));
		t.diagnostic(`reindex during load: ${JSON.stringify(rebuilt)}; outbox drained in ${drain.seconds} s`);

		assert.equal(
			searchStats.errors,
			0,
			`search errors during rebuild: ${JSON.stringify(searchStats.notes)} ${JSON.stringify(searchStats.statuses)}`,
		);
		assert.equal(writeStats.errors, 0, `write errors: ${JSON.stringify(writeStats.notes)}`);
		assert.equal(rebuilt.state, "succeeded", JSON.stringify(rebuilt));
		assert.ok(drain.drained, `outbox did not drain after the mixed phase: ${JSON.stringify(drain)}`);
		assert.ok(searchStats.p95Ms <= CFG.maxSearchP95Ms, `search p95 ${searchStats.p95Ms} ms during rebuild`);
	});
});
