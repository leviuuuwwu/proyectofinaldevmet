// Acceptance: full-text search with filters, deterministic order and pagination
// (ESC4-03, ESC4-04, ESC4-05; P4-1). Every test isolates its data with a per-run category
// and unique words, so the result is the same whatever else is in the database.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
	api,
	assertProblem,
	createDocument,
	runId,
	type SearchHit,
	search,
	uniqueWord,
	type WriteAccepted,
	waitAllIndexed,
} from "./helpers.ts";

const category = `acc-search-${runId}`;
const otherCategory = `acc-search-otra-${runId}`;
const WORD = uniqueWord();
const OTHER_WORD = uniqueWord();

interface Seeded extends WriteAccepted {
	label: string;
	date: string;
}
const seeded: Record<string, Seeded> = {};

async function seed(
	label: string,
	input: Parameters<typeof createDocument>[0],
): Promise<void> {
	const created = await createDocument({ category, ...input });
	seeded[label] = { ...created, label, date: input?.date ?? "" };
}

const ids = (hits: SearchHit[]) => hits.map((h) => h.id);
const id = (label: string) => (seeded[label] as Seeded).id;

before(async () => {
	await Promise.all([
		seed("title", {
			title: `Respaldos ${WORD} de bases de datos`,
			description: "Procedimiento general.",
			tags: ["postgres", "respaldo"],
			date: "2026-03-01T00:00:00.000Z",
		}),
		seed("desc", {
			title: "Procedimiento de restauración",
			description: `Incluye notas sobre ${WORD} y otros temas.`,
			tags: ["postgres"],
			date: "2026-03-02T00:00:00.000Z",
		}),
		seed("other", {
			title: `Documento sobre ${OTHER_WORD}`,
			description: "Sin relación con el término principal.",
			tags: ["redes"],
			date: "2026-03-03T00:00:00.000Z",
		}),
		seed("excl", {
			title: `Aviso ${WORD} obsoleto`,
			description: `Marcado como ${OTHER_WORD}.`,
			tags: ["postgres", "respaldo", "redes"],
			date: "2026-03-04T00:00:00.000Z",
		}),
		seed("phrase", {
			title: "Plan de contingencia regional",
			description: "Ejecutar el plan de contingencia regional ante fallos.",
			tags: ["contingencia"],
			date: "2026-03-05T00:00:00.000Z",
		}),
		seed("phrase2", {
			title: "Contingencia del plan regional",
			description: "Orden distinto de las palabras.",
			tags: ["contingencia"],
			date: "2026-03-06T00:00:00.000Z",
		}),
		seed("draft", {
			title: `Borrador ${WORD}`,
			status: "draft",
			date: "2026-03-07T00:00:00.000Z",
		}),
		seed("otherCat", {
			title: `Otra categoría ${WORD}`,
			category: otherCategory,
			date: "2026-03-08T00:00:00.000Z",
		}),
	]);
	// A document that is published and then unpublished must never be returned.
	const gone = await createDocument({
		category,
		title: `Retirado ${WORD}`,
		date: "2026-03-09T00:00:00.000Z",
	});
	await api("POST", `/documents/${gone.id}/unpublish`, { role: "editor" });
	seeded.gone = { ...gone, version: 2, label: "gone", date: "" };
	await waitAllIndexed(Object.values(seeded));
});

describe("texto", () => {
	it("encuentra por palabras del título y de la descripción", async () => {
		const res = await search({ q: WORD, category });
		assert.equal(res.status, 200);
		assert.deepEqual(
			new Set(ids(res.body.items)),
			new Set([id("title"), id("desc"), id("excl")]),
		);
		assert.equal(res.body.total, 3);
	});

	it("un término sin coincidencias devuelve total 0 e items vacío", async () => {
		const res = await search({ q: uniqueWord(), category });
		assert.equal(res.status, 200);
		assert.equal(res.body.total, 0);
		assert.deepEqual(res.body.items, []);
	});

	it("aplica stemming en español ('respaldo' encuentra 'Respaldos')", async () => {
		const res = await search({ q: "respaldo", category });
		assert.ok(ids(res.body.items).includes(id("title")));
	});

	it("una palabra solo en las etiquetas no coincide (el texto es título + descripción)", async () => {
		const res = await search({ q: "contingencia", category });
		// 'contingencia' aparece en título/descripción de phrase y phrase2, no por la etiqueta.
		assert.deepEqual(
			new Set(ids(res.body.items)),
			new Set([id("phrase"), id("phrase2")]),
		);
	});

	it('"frase exacta" exige las palabras juntas y en orden', async () => {
		const res = await search({ q: '"plan de contingencia regional"', category });
		assert.deepEqual(ids(res.body.items), [id("phrase")]);
	});

	it("-excluir quita los documentos que contienen el término", async () => {
		const res = await search({ q: `${WORD} -${OTHER_WORD}`, category });
		assert.deepEqual(
			new Set(ids(res.body.items)),
			new Set([id("title"), id("desc")]),
		);
	});

	it("'or' une términos", async () => {
		const res = await search({ q: `${OTHER_WORD} or contingencia`, category });
		assert.deepEqual(
			new Set(ids(res.body.items)),
			new Set([id("other"), id("excl"), id("phrase"), id("phrase2")]),
		);
	});

	it("solo devuelve publicados: ni borradores ni despublicados", async () => {
		const res = await search({ q: WORD, category });
		const returned = new Set(ids(res.body.items));
		assert.ok(!returned.has(id("draft")));
		assert.ok(!returned.has(id("gone")));
	});

	it("cada resultado trae los campos del contrato", async () => {
		const res = await search({ q: WORD, category });
		for (const hit of res.body.items) {
			assert.match(hit.id, /^[0-9a-f-]{36}$/);
			assert.equal(typeof hit.title, "string");
			assert.equal(typeof hit.description, "string");
			assert.ok(Array.isArray(hit.tags));
			assert.equal(hit.category, category);
			assert.ok(!Number.isNaN(Date.parse(hit.date)));
			assert.equal(typeof hit.rank, "number");
		}
	});
});

describe("filtros", () => {
	it("category es igualdad exacta", async () => {
		const res = await search({ q: WORD, category: otherCategory });
		assert.deepEqual(ids(res.body.items), [id("otherCat")]);
	});

	it("una categoría inexistente devuelve total 0", async () => {
		const res = await search({ category: `no-existe-${runId}` });
		assert.equal(res.body.total, 0);
	});

	it("tags exige TODAS las etiquetas indicadas", async () => {
		const one = await search({ category, tags: ["postgres"] });
		assert.deepEqual(
			new Set(ids(one.body.items)),
			new Set([id("title"), id("desc"), id("excl")]),
		);
		const both = await search({ category, tags: ["postgres", "respaldo"] });
		assert.deepEqual(
			new Set(ids(both.body.items)),
			new Set([id("title"), id("excl")]),
		);
		const three = await search({
			category,
			tags: ["postgres", "respaldo", "redes"],
		});
		assert.deepEqual(ids(three.body.items), [id("excl")]);
	});

	it("una etiqueta que ningún documento tiene → total 0", async () => {
		const res = await search({ category, tags: ["postgres", "inexistente"] });
		assert.equal(res.body.total, 0);
	});

	it("texto + etiquetas + categoría se combinan con AND", async () => {
		const res = await search({
			q: WORD,
			category,
			tags: ["respaldo"],
		});
		assert.deepEqual(
			new Set(ids(res.body.items)),
			new Set([id("title"), id("excl")]),
		);
	});

	it("sin q, la categoría lista todos los publicados de esa categoría", async () => {
		const res = await search({ category });
		assert.deepEqual(
			new Set(ids(res.body.items)),
			new Set([
				id("title"),
				id("desc"),
				id("other"),
				id("excl"),
				id("phrase"),
				id("phrase2"),
			]),
		);
		assert.equal(res.body.total, 6);
	});
});

describe("orden determinista", () => {
	it("sort=date: fecha descendente", async () => {
		const res = await search({ category, sort: "date" });
		const dates = res.body.items.map((h) => Date.parse(h.date));
		assert.deepEqual(
			dates,
			[...dates].sort((a, b) => b - a),
		);
		assert.deepEqual(ids(res.body.items), [
			id("phrase2"),
			id("phrase"),
			id("excl"),
			id("other"),
			id("desc"),
			id("title"),
		]);
	});

	it("sin q, relevance equivale a date y rank vale 0", async () => {
		const byRelevance = await search({ category, sort: "relevance" });
		const byDate = await search({ category, sort: "date" });
		assert.deepEqual(ids(byRelevance.body.items), ids(byDate.body.items));
		for (const hit of byRelevance.body.items) assert.equal(hit.rank, 0);
	});

	it("relevance: el término en el título (peso A) rankea sobre la descripción (peso B)", async () => {
		const res = await search({ q: WORD, category, sort: "relevance" });
		const hits = res.body.items;
		const title = hits.find((h) => h.id === id("title")) as SearchHit;
		const desc = hits.find((h) => h.id === id("desc")) as SearchHit;
		assert.ok(title.rank > 0 && desc.rank > 0);
		assert.ok(title.rank > desc.rank, "title match outranks description match");
		assert.ok(ids(hits).indexOf(id("title")) < ids(hits).indexOf(id("desc")));
		for (let i = 1; i < hits.length; i++) {
			assert.ok((hits[i - 1] as SearchHit).rank >= (hits[i] as SearchHit).rank);
		}
	});

	it("empate de fecha: desempata por id ascendente", async () => {
		const tieCategory = `acc-tie-${runId}`;
		const date = "2026-04-01T00:00:00.000Z";
		const docs = await Promise.all(
			Array.from({ length: 4 }, (_, i) =>
				createDocument({
					category: tieCategory,
					date,
					title: `Empate ${i} ${uniqueWord()}`,
				}),
			),
		);
		await waitAllIndexed(docs);
		const res = await search({ category: tieCategory, sort: "date" });
		assert.deepEqual(ids(res.body.items), docs.map((d) => d.id).sort());
	});

	it("la misma consulta repetida da exactamente el mismo resultado", async () => {
		const first = await search({ q: WORD, category, sort: "relevance" });
		const second = await search({ q: WORD, category, sort: "relevance" });
		assert.deepEqual(first.body, second.body);
	});
});

describe("paginación", () => {
	const pageCategory = `acc-page-${runId}`;
	const docs: WriteAccepted[] = [];

	before(async () => {
		for (let i = 0; i < 7; i++) {
			docs.push(
				await createDocument({
					category: pageCategory,
					title: `Página ${i} ${uniqueWord()}`,
					date: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
				}),
			);
		}
		await waitAllIndexed(docs);
	});

	it("total no depende de la página y recorrer todo da cada resultado exactamente una vez", async () => {
		const seen: string[] = [];
		const sizes: number[] = [];
		for (let page = 1; page <= 3; page++) {
			const res = await search({
				category: pageCategory,
				sort: "date",
				page: String(page),
				pageSize: "3",
			});
			assert.equal(res.status, 200);
			assert.equal(res.body.total, 7);
			assert.equal(res.body.page, page);
			assert.equal(res.body.pageSize, 3);
			sizes.push(res.body.items.length);
			seen.push(...ids(res.body.items));
		}
		assert.deepEqual(sizes, [3, 3, 1]);
		assert.equal(new Set(seen).size, 7, "sin duplicados");
		assert.deepEqual(new Set(seen), new Set(docs.map((d) => d.id)));
	});

	it("una página fuera de rango devuelve items vacío con el total correcto", async () => {
		const res = await search({
			category: pageCategory,
			page: "4",
			pageSize: "3",
		});
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.items, []);
		assert.equal(res.body.total, 7);
	});

	it("pageSize por defecto es 20 y el máximo 50 es válido", async () => {
		const byDefault = await search({ category: pageCategory });
		assert.equal(byDefault.body.pageSize, 20);
		assert.equal(byDefault.body.page, 1);
		const max = await search({ category: pageCategory, pageSize: "50" });
		assert.equal(max.status, 200);
		assert.equal(max.body.items.length, 7);
	});
});

describe("validación de la consulta", () => {
	const bad: [string, Record<string, string | string[]>][] = [
		["pageSize 51", { pageSize: "51" }],
		["pageSize 0", { pageSize: "0" }],
		["page 0", { page: "0" }],
		["page no numérico", { page: "abc" }],
		["page mayor al máximo", { page: "10001" }],
		["q vacío", { q: "" }],
		["q de más de 200 caracteres", { q: "a".repeat(201) }],
		["sort desconocido", { sort: "popularidad" }],
		["etiqueta inválida", { tags: ["Mayuscula"] }],
		["más de 10 etiquetas", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
		["parámetro desconocido", { foo: "bar" }],
	];
	for (const [name, query] of bad) {
		it(`${name} → 400`, async () => {
			assertProblem(await search(query), 400, "/problems/validation");
		});
	}
});

describe("roles", () => {
	it("un reader puede buscar", async () => {
		const res = await api("GET", `/search?q=${WORD}`, { role: "reader" });
		assert.equal(res.status, 200);
	});
});
