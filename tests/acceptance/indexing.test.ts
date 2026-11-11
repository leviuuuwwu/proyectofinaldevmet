// Acceptance: eventual consistency. "Saved in the catalog" is not "applied to the index"
// (ESC4-05, ESC4-06, ESC4-09; P4-2). Visibility in /search is awaited by polling, never by sleeping.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	api,
	assertProblem,
	createDocument,
	type DocumentIndexStatus,
	NIL_UUID,
	runId,
	search,
	uniqueWord,
	validDocument,
	type WriteAccepted,
	waitFor,
	waitIndexed,
} from "./helpers.ts";

const category = `acc-idx-${runId}`;

const status = (id: string) =>
	api<DocumentIndexStatus>("GET", `/documents/${id}/index-status`, {
		role: "editor",
	});

const found = async (word: string, id: string) =>
	(await search({ q: word, category })).body.items.some((h) => h.id === id);

describe("GET /documents/{id}/index-status", () => {
	it("justo tras escribir, el estado es pending o indexed y refleja la versión del catálogo", async () => {
		const created = await createDocument({ category });
		const res = await status(created.id);
		assert.equal(res.status, 200);
		assert.equal(res.body.docId, created.id);
		assert.equal(res.body.catalogVersion, 1);
		assert.ok(["pending", "indexed"].includes(res.body.state));
		assert.ok(!Number.isNaN(Date.parse(res.body.committedAt)));
		if (res.body.state === "pending") {
			assert.equal(res.body.indexedVersion, null);
			assert.equal(res.body.indexedAt, null);
		}
	});

	it("pasa a indexed con indexedVersion = catalogVersion", async () => {
		const created = await createDocument({ category });
		const s = await waitIndexed(created.id, 1);
		assert.equal(s.catalogVersion, 1);
		assert.equal(s.indexedVersion, 1);
		assert.equal(s.lastError, null);
		assert.ok(s.indexedAt && !Number.isNaN(Date.parse(s.indexedAt)));
	});

	it("un borrador también tiene estado de indexación (indexed) aunque no esté en el índice", async () => {
		const word = uniqueWord();
		const created = await createDocument({
			category,
			status: "draft",
			title: `Borrador ${word}`,
		});
		const s = await waitIndexed(created.id, 1);
		assert.equal(s.state, "indexed");
		assert.equal(await found(word, created.id), false);
	});

	it("una actualización vuelve el estado a pending/indexed con la versión nueva", async () => {
		const created = await createDocument({ category });
		await waitIndexed(created.id, 1);
		const put = await api<WriteAccepted>("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 1,
			body: validDocument({ category }),
		});
		assert.equal(put.status, 200);
		const right = await status(created.id);
		assert.equal(right.body.catalogVersion, 2);
		assert.ok(["pending", "indexed"].includes(right.body.state));
		const s = await waitIndexed(created.id, 2);
		assert.equal(s.indexedVersion, 2);
	});

	it("documento inexistente → 404", async () => {
		assertProblem(await status(NIL_UUID), 404, "/problems/not-found");
	});

	it("id inválido → 400", async () => {
		assertProblem(await status("nope"), 400, "/problems/validation");
	});
});

describe("visibilidad en /search (consistencia eventual)", () => {
	it("un documento publicado se vuelve visible en la búsqueda", async () => {
		const word = uniqueWord();
		const created = await createDocument({
			category,
			title: `Publicado ${word}`,
		});
		await waitFor(() => found(word, created.id), "published doc to appear in search");
		await waitIndexed(created.id, 1);
	});

	it("tras actualizar, la búsqueda muestra el título nuevo y deja de mostrar el viejo", async () => {
		const oldWord = uniqueWord();
		const newWord = uniqueWord();
		const created = await createDocument({
			category,
			title: `Antes ${oldWord}`,
		});
		await waitFor(() => found(oldWord, created.id), "old title indexed");
		const put = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 1,
			body: validDocument({ category, title: `Después ${newWord}` }),
		});
		assert.equal(put.status, 200);
		await waitFor(() => found(newWord, created.id), "new title indexed");
		assert.equal(await found(oldWord, created.id), false);
	});

	it("tras despublicar, el documento desaparece de la búsqueda pero sigue en el catálogo", async () => {
		const word = uniqueWord();
		const created = await createDocument({ category, title: `Efímero ${word}` });
		await waitFor(() => found(word, created.id), "doc indexed before unpublish");
		const res = await api("POST", `/documents/${created.id}/unpublish`, {
			role: "editor",
		});
		assert.equal(res.status, 200);
		await waitFor(
			async () => !(await found(word, created.id)),
			"unpublished doc to leave the index",
		);
		const s = await waitIndexed(created.id, 2);
		assert.equal(s.catalogVersion, 2);
		const doc = await api<{ status: string }>("GET", `/documents/${created.id}`, {
			role: "editor",
		});
		assert.equal(doc.body.status, "unpublished");
	});

	it("publicar de nuevo un despublicado lo devuelve a la búsqueda", async () => {
		const word = uniqueWord();
		const created = await createDocument({ category, title: `Vuelve ${word}` });
		await waitFor(() => found(word, created.id), "initial index");
		await api("POST", `/documents/${created.id}/unpublish`, { role: "editor" });
		await waitFor(async () => !(await found(word, created.id)), "removed");
		const put = await api("PUT", `/documents/${created.id}`, {
			role: "editor",
			ifMatch: 2,
			body: validDocument({ category, title: `Vuelve ${word}` }),
		});
		assert.equal(put.status, 200);
		await waitFor(() => found(word, created.id), "back in the index");
	});

	it("varias ediciones seguidas terminan con la última versión indexada (sin versiones viejas)", async () => {
		const created = await createDocument({ category });
		let version = 1;
		for (let i = 0; i < 5; i++) {
			const res = await api<WriteAccepted>("PUT", `/documents/${created.id}`, {
				role: "editor",
				ifMatch: version,
				body: validDocument({ category, title: `Edición ${i} ${uniqueWord()}` }),
			});
			assert.equal(res.status, 200);
			version = res.body.version;
		}
		const s = await waitIndexed(created.id, version);
		assert.equal(s.indexedVersion, version);
		assert.equal(s.catalogVersion, version);
	});
});

describe("GET /index/status", () => {
	it("devuelve el resumen del outbox con los tipos del contrato", async () => {
		const res = await api<{
			pending: number;
			failed: number;
			oldestPendingAgeSeconds: number | null;
			lastIndexedAt: string | null;
		}>("GET", "/index/status", { role: "editor" });
		assert.equal(res.status, 200);
		assert.ok(Number.isInteger(res.body.pending) && res.body.pending >= 0);
		assert.ok(Number.isInteger(res.body.failed) && res.body.failed >= 0);
		assert.ok(
			res.body.oldestPendingAgeSeconds === null ||
				typeof res.body.oldestPendingAgeSeconds === "number",
		);
		assert.ok(
			res.body.lastIndexedAt === null ||
				!Number.isNaN(Date.parse(res.body.lastIndexedAt)),
		);
	});

	it("lastIndexedAt avanza cuando se indexa un documento", async () => {
		const created = await createDocument({ category });
		const s = await waitIndexed(created.id, 1);
		const res = await api<{ lastIndexedAt: string | null }>(
			"GET",
			"/index/status",
			{ role: "editor" },
		);
		assert.ok(res.body.lastIndexedAt);
		assert.ok(
			Date.parse(res.body.lastIndexedAt) >= Date.parse(s.indexedAt as string),
		);
	});
});
