// Load-test helpers: HTTP client, bounded-concurrency runners and latency statistics.
// Only fetch + node:test (ADR 0001): no k6, no extra dependencies.
//
// The runners are closed-loop: each virtual user (VU) sends its next request when the previous
// one finishes. That measures what the system sustains at a given concurrency, but a slow
// response also slows the offered load (coordinated omission), so treat p99 as a lower bound.

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";

const TOKENS = {
	reader: process.env.READER_TOKEN ?? "dev-reader-token",
	editor: process.env.EDITOR_TOKEN ?? "dev-editor-token",
	admin: process.env.ADMIN_TOKEN ?? "dev-admin-token",
} as const;

export type Role = keyof typeof TOKENS;

/** One request outcome. `ok` already includes any response validation the caller did. */
export interface Sample {
	ok: boolean;
	status: number;
	ms: number;
	note?: string;
}

export interface HttpResult<T> {
	status: number;
	body: T;
	ms: number;
}

/** Never throws: a network error or timeout becomes status 0. */
export async function http<T = unknown>(
	method: string,
	path: string,
	role: Role,
	body?: unknown,
	ifMatch?: number,
): Promise<HttpResult<T>> {
	const started = performance.now();
	try {
		const res = await fetch(`${BASE_URL}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${TOKENS[role]}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
				...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		const text = await res.text();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = text;
		}
		return {
			status: res.status,
			body: parsed as T,
			ms: performance.now() - started,
		};
	} catch {
		return { status: 0, body: null as T, ms: performance.now() - started };
	}
}

export const num = (name: string, fallback: number): number => {
	const value = Number(process.env[name] ?? fallback);
	return Number.isFinite(value) ? value : fallback;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nearest-rank percentile of an ascending array. */
export function percentile(sortedAsc: number[], p: number): number {
	if (sortedAsc.length === 0) return 0;
	const rank = Math.ceil((p / 100) * sortedAsc.length);
	return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))] as number;
}

export interface Stats {
	requests: number;
	errors: number;
	rps: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	maxMs: number;
	statuses: Record<string, number>;
	notes: Record<string, number>;
}

const round = (n: number, digits = 1) => Number(n.toFixed(digits));

export function summarize(samples: Sample[], seconds: number): Stats {
	const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
	const statuses: Record<string, number> = {};
	const notes: Record<string, number> = {};
	for (const s of samples) {
		statuses[s.status] = (statuses[s.status] ?? 0) + 1;
		if (!s.ok && s.note) notes[s.note] = (notes[s.note] ?? 0) + 1;
	}
	return {
		requests: samples.length,
		errors: samples.filter((s) => !s.ok).length,
		rps: round(samples.length / Math.max(seconds, 0.001)),
		p50Ms: round(percentile(latencies, 50)),
		p95Ms: round(percentile(latencies, 95)),
		p99Ms: round(percentile(latencies, 99)),
		maxMs: round(latencies.at(-1) ?? 0),
		statuses,
		notes,
	};
}

export type Step = (vu: number, iteration: number) => Promise<Sample>;

/** `vus` virtual users loop `step` until `seconds` have passed. */
export async function runFor(
	seconds: number,
	vus: number,
	step: Step,
): Promise<{ samples: Sample[]; seconds: number }> {
	const started = performance.now();
	const deadline = started + seconds * 1000;
	const samples: Sample[] = [];
	await Promise.all(
		Array.from({ length: vus }, async (_, vu) => {
			for (let n = 0; performance.now() < deadline; n++) {
				samples.push(await step(vu, n));
			}
		}),
	);
	return { samples, seconds: (performance.now() - started) / 1000 };
}

/** `vus` virtual users together perform exactly `total` operations. */
export async function runCount(
	total: number,
	vus: number,
	step: Step,
): Promise<{ samples: Sample[]; seconds: number }> {
	const started = performance.now();
	const samples: Sample[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: vus }, async (_, vu) => {
			for (;;) {
				const n = next++;
				if (n >= total) return;
				samples.push(await step(vu, n));
			}
		}),
	);
	return { samples, seconds: (performance.now() - started) / 1000 };
}

export interface Drain {
	drained: boolean;
	seconds: number;
	pending: number;
	failed: number;
}

/** Polls /index/status until the outbox is empty (pending = 0 and failed = 0). */
export async function waitDrained(timeoutSeconds: number): Promise<Drain> {
	const started = performance.now();
	let pending = -1;
	let failed = -1;
	while ((performance.now() - started) / 1000 < timeoutSeconds) {
		const res = await http<{ pending: number; failed: number }>(
			"GET",
			"/index/status",
			"editor",
		);
		if (res.status === 200) {
			pending = res.body.pending;
			failed = res.body.failed;
			if (pending === 0 && failed === 0) {
				return {
					drained: true,
					seconds: round((performance.now() - started) / 1000, 2),
					pending,
					failed,
				};
			}
		}
		await sleep(100);
	}
	return {
		drained: false,
		seconds: round((performance.now() - started) / 1000, 2),
		pending,
		failed,
	};
}

/**
 * Reads a Prometheus counter from the API's /metrics. 0 when the series does not exist yet
 * (Prometheus clients only emit a labelled series after its first increment); null when the
 * endpoint is unreachable.
 */
export async function readCounter(
	name: string,
	labels: string,
): Promise<number | null> {
	try {
		const res = await fetch(`${BASE_URL}/metrics`, {
			signal: AbortSignal.timeout(5_000),
		});
		const text = await res.text();
		const line = text
			.split("\n")
			.find((l) => l.startsWith(`${name}{${labels}}`));
		return line ? Number(line.split(" ").at(-1)) : 0;
	} catch {
		return null;
	}
}
