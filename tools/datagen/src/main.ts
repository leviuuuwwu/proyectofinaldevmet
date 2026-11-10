// Datagen (ESC4-10, P4-1): loads fictitious documents through the HTTP API,
// applies updates/unpublishes, then waits for the index to converge.
//
// Env: BASE_URL (default http://localhost:8080), EDITOR_TOKEN (required),
//      SEED (default 42), DOCS (default 2000), CHANGES (default 100).
import { createRng, generateDocument, generateDocuments } from "./data.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const TOKEN = process.env.EDITOR_TOKEN;
const SEED = Number(process.env.SEED ?? 42);
const DOCS = Number(process.env.DOCS ?? 2000);
const CHANGES = Number(process.env.CHANGES ?? 100);
const CONCURRENCY = 10;
const WAIT_TIMEOUT_MS = 120_000;

if (!TOKEN) {
	console.error("EDITOR_TOKEN is required (use the fictitious dev token).");
	process.exit(1);
}

async function call(
	method: string,
	path: string,
	body?: unknown,
	ifMatch?: number,
) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${TOKEN}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Runs tasks with bounded concurrency. */
async function pool<T>(
	items: T[],
	worker: (item: T, i: number) => Promise<void>,
) {
	let next = 0;
	const runners = Array.from({ length: CONCURRENCY }, async () => {
		while (next < items.length) {
			const i = next++;
			await worker(items[i] as T, i);
		}
	});
	await Promise.all(runners);
}

interface Created {
	id: string;
	version: number;
}

async function main() {
	const rng = createRng(SEED);
	const docs = generateDocuments(rng, DOCS);
	const created: Created[] = new Array(DOCS);
	let failures = 0;

	console.log(`Creating ${DOCS} documents (seed ${SEED}) at ${BASE_URL}…`);
	await pool(docs, async (doc, i) => {
		const res = await call("POST", "/documents", doc);
		if (res.status !== 201) {
			failures++;
			console.error(`create #${i} → ${res.status}`);
			return;
		}
		created[i] = { id: res.json.id, version: res.json.version };
	});

	// Changes are sequential per document, so If-Match always uses the right version.
	const ok = created.map((c, i) => [c, i] as const).filter(([c]) => c);
	let updated = 0;
	let unpublished = 0;
	console.log(`Applying ${CHANGES} changes…`);
	for (let n = 0; n < CHANGES && n < ok.length; n++) {
		const [doc] = ok[Math.floor(rng() * ok.length)] as (typeof ok)[number];
		if (n % 2 === 0) {
			const res = await call(
				"PUT",
				`/documents/${doc.id}`,
				generateDocument(rng),
				doc.version,
			);
			if (res.status === 200) {
				doc.version = res.json.version;
				updated++;
			} else failures++;
		} else {
			const res = await call("POST", `/documents/${doc.id}/unpublish`);
			if (res.status === 200) {
				doc.version = res.json.version;
				unpublished++;
			} else failures++;
		}
	}

	console.log("Waiting for the index to converge…");
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	let pending = -1;
	let failed = -1;
	while (Date.now() < deadline) {
		const res = await call("GET", "/index/status");
		if (res.status === 200) {
			pending = res.json.pending;
			failed = res.json.failed;
			if (pending === 0) break;
		}
		await new Promise((r) => setTimeout(r, 1000));
	}

	console.log(
		JSON.stringify({
			created: ok.length,
			updated,
			unpublished,
			failures,
			pending,
			failed,
		}),
	);
	if (failures > 0 || pending !== 0 || failed !== 0) process.exit(1);
}

await main();
