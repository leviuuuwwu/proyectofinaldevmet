// Acceptance: catalog writes and reads, optimistic concurrency, validation (ESC4-01, ESC4-02).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	api,
	assertProblem,
	createDocument,
	type DocumentDto,
	NIL_UUID,
	UUID,
	validDocument,
	type WriteAccepted,
} from "./helpers.ts";

const get = (id: string) =>
	api<DocumentDto>("GET", `/documents/${id}`, { role: "editor" });

describe("POST /documents", () => {
	it("crea el documento: 201, Location, ETag y indexState pending", async () => {
		const input = validDocument({ tags: ["uno", "dos"] });
		const res = await api<WriteAccepted>("POST", "/documents", {
			role: "editor",
			body: input,
		});
		assert.equal(res.status, 201);
		assert.match(res.body.id, UUID);
		assert.equal(res.body.version, 1);
		assert.equal(res.body.indexState, "pending");
		assert.equal(res.headers.get("location"), `/documents/${res.body.id}`);
		assert.equal(res.headers.get("etag"), '"1"');
	});

	it("el documento leído coincide con lo enviado", async () => {
		const input = validDocument({ tags: ["uno", "dos"], status: "published" });
		const { id } = await createDocument(input);
		const res = await get(id);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get("etag"), '"1"');
		const doc = res.body;
		assert.equal(doc.id, id);
		assert.equal(doc.title, input.title);
		assert.equal(doc.description, input.description);
		assert.deepEqual(doc.tags, ["uno", "dos"]);
		assert.equal(doc.category, input.category);
		assert.equal(new Date(doc.date).toISOString(), input.date);
		assert.equal(doc.status, "published");
		assert.equal(doc.version, 1);
		assert.ok(!Number.isNaN(Date.parse(doc.createdAt)));
		assert.ok(!Number.isNaN(Date.parse(doc.updatedAt)));
	});

	it("description y tags son opcionales (por defecto '' y [])", async () => {
		const { title, category, date } = validDocument();
		const res = await api<WriteAccepted>("POST", "/documents", {
			role: "editor",
			body: { title, category, date, status: "draft" },
		});
		assert.equal(res.status, 201);
		const doc = (await get(res.body.id)).body;
		assert.equal(doc.description, "");
		assert.deepEqual(doc.tags, []);
		assert.equal(doc.status, "draft");
	});

	it("un borrador se guarda en el catálogo y se lee en cualquier estado", async () => {
		const { id } = await createDocument({ status: "draft" });
		const res = await get(id);
		assert.equal(res.status, 200);
		assert.equal(res.body.status, "draft");
	});

	const invalid: [string, Record<string, unknown>][] = [
		["título vacío", { title: "" }],
		["título de más de 200 caracteres", { title: "a".repeat(201) }],
		["descripción de más de 2000 caracteres", { description: "a".repeat(2001) }],
		["categoría vacía", { category: "" }],
		["categoría de más de 50 caracteres", { category: "a".repeat(51) }],
		["más de 10 etiquetas", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
		["etiqueta con mayúsculas", { tags: ["Mayuscula"] }],
		["etiqueta con espacios", { tags: ["dos palabras"] }],
		["etiqueta de más de 40 caracteres", { tags: ["a".repeat(41)] }],
		["etiquetas repetidas", { tags: ["igual", "igual"] }],
		["fecha inválida", { date: "ayer" }],
		["estado 'unpublished' (solo por /unpublish)", { status: "unpublished" }],
		["estado desconocido", { status: "archived" }],
		["propiedad desconocida", { extra: true }],
	];
	for (const [name, override] of invalid) {
		it(`rechaza con 400: ${name}`, async () => {
			const res = await api("POST", "/documents", {
				role: "editor",
				body: { ...validDocument(), ...override },
			});
			const problem = assertProblem(res, 400, "/problems/validation");
			assert.ok(Array.isArray(problem.errors) && problem.errors.length > 0);
		});
	}

	it("rechaza con 400 si faltan campos obligatorios", async () => {
		const res = await api("POST", "/documents", {
			role: "editor",
			body: { title: "solo título" },
		});
		assertProblem(res, 400, "/problems/validation");
	});

	it("los límites exactos son válidos", async () => {
		const res = await api("POST", "/documents", {
			role: "editor",
			body: validDocument({
				title: "a".repeat(200),
				description: "b".repeat(2000),
				category: "c".repeat(50),
				tags: Array.from({ length: 10 }, (_, i) => `t${i}`),
			}),
		});
		assert.equal(res.status, 201, JSON.stringify(res.body));
	});
});

describe("GET /documents/{id}", () => {
	it("id inexistente → 404 problem+json", async () => {
		assertProblem(await get(NIL_UUID), 404, "/problems/not-found");
	});

	it("id que no es UUID → 400", async () => {
		assertProblem(await get("no-es-uuid"), 400, "/problems/validation");
	});
});

describe("PUT /documents/{id} (If-Match)", () => {
	it("con la versión correcta → 200, versión +1 y ETag nuevo", async () => {
		const created = await createDocument();
		const res = await api<WriteAccepted>("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: '"1"',
			body: validDocument({ title: "Título actualizado" }),
		});
		assert.equal(res.status, 200);
		assert.equal(res.body.id, created.id);
		assert.equal(res.body.version, 2);
		assert.equal(res.body.indexState, "pending");
		assert.equal(res.headers.get("etag"), '"2"');
		const doc = (await get(created.id)).body;
		assert.equal(doc.title, "Título actualizado");
		assert.equal(doc.version, 2);
	});

	it("acepta If-Match sin comillas", async () => {
		const created = await createDocument();
		const res = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 1,
			body: validDocument(),
		});
		assert.equal(res.status, 200);
	});

	it("versión obsoleta → 409 y el documento no cambia", async () => {
		const created = await createDocument();
		const first = await api<WriteAccepted>("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 1,
			body: validDocument({ title: "Primera edición" }),
		});
		assert.equal(first.status, 200);
		// El segundo cliente aún cree que la versión es la 1.
		const stale = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 1,
			body: validDocument({ title: "Edición obsoleta" }),
		});
		const problem = assertProblem(stale, 409, "/problems/version-conflict");
		assert.match(problem.detail ?? "", /2/);
		const doc = (await get(created.id)).body;
		assert.equal(doc.title, "Primera edición");
		assert.equal(doc.version, 2);
	});

	it("dos actualizaciones simultáneas con la misma versión: solo una gana", async () => {
		const created = await createDocument();
		const [a, b] = await Promise.all([
			api("PUT", `/documents/${created.id}`, {
				role: "editor",
				ifMatch: 1,
				body: validDocument({ title: "Gana A" }),
			}),
			api("PUT", `/documents/${created.id}`, {
				role: "editor",
				ifMatch: 1,
				body: validDocument({ title: "Gana B" }),
			}),
		]);
		assert.deepEqual([a.status, b.status].sort(), [200, 409]);
		assert.equal((await get(created.id)).body.version, 2);
	});

	it("sin If-Match → 400", async () => {
		const created = await createDocument();
		const res = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			body: validDocument(),
		});
		assertProblem(res, 400, "/problems/validation");
	});

	it("If-Match con formato inválido → 400", async () => {
		const created = await createDocument();
		const res = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: "abc",
			body: validDocument(),
		});
		assertProblem(res, 400, "/problems/validation");
	});

	it("documento inexistente → 404", async () => {
		const res = await api("PUT", `/documents/${NIL_UUID}`, {
			role: "editor",
			ifMatch: 1,
			body: validDocument(),
		});
		assertProblem(res, 404, "/problems/not-found");
	});

	it("cuerpo inválido → 400 y la versión no cambia", async () => {
		const created = await createDocument();
		const res = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 1,
			body: { ...validDocument(), title: "" },
		});
		assertProblem(res, 400, "/problems/validation");
		assert.equal((await get(created.id)).body.version, 1);
	});

	it("la versión sube en cada escritura", async () => {
		const created = await createDocument();
		for (let expected = 2; expected <= 4; expected++) {
			const res = await api<WriteAccepted>("PUT", `/documents/${created.id}`, {
				role: "editor",
				ifMatch: expected - 1,
				body: validDocument(),
			});
			assert.equal(res.status, 200);
			assert.equal(res.body.version, expected);
		}
	});
});

describe("POST /documents/{id}/unpublish", () => {
	it("despublica: 200, versión +1, el catálogo conserva el documento", async () => {
		const created = await createDocument();
		const res = await api<WriteAccepted>(
			"POST",
			`/documents/${created.id}/unpublish`,
			{ role: "editor" },
		);
		assert.equal(res.status, 200);
		assert.equal(res.body.version, 2);
		assert.equal(res.body.indexState, "pending");
		const doc = (await get(created.id)).body;
		assert.equal(doc.status, "unpublished");
		assert.equal(doc.version, 2);
	});

	it("es idempotente: repetir no crea una versión nueva", async () => {
		const created = await createDocument();
		const first = await api<WriteAccepted>(
			"POST",
			`/documents/${created.id}/unpublish`,
			{ role: "editor" },
		);
		const second = await api<WriteAccepted>(
			"POST",
			`/documents/${created.id}/unpublish`,
			{ role: "editor" },
		);
		assert.equal(second.status, 200);
		assert.equal(second.body.version, first.body.version);
		assert.equal((await get(created.id)).body.version, first.body.version);
	});

	it("documento inexistente → 404", async () => {
		assertProblem(
			await api("POST", `/documents/${NIL_UUID}/unpublish`, { role: "editor" }),
			404,
			"/problems/not-found",
		);
	});

	it("un documento despublicado puede volver a publicarse con PUT", async () => {
		const created = await createDocument();
		await api("POST", `/documents/${created.id}/unpublish`, { role: "editor" });
		const res = await api<WriteAccepted>("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 2,
			body: validDocument({ status: "published" }),
		});
		assert.equal(res.status, 200);
		assert.equal(res.body.version, 3);
		assert.equal((await get(created.id)).body.status, "published");
	});
});
