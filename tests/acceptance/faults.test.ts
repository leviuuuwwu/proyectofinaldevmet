// Acceptance: indexing failures are visible and recoverable (P4-3, MET-06, MET-07).
// Needs the indexer started with INDEXER_FAULT_CATEGORY=fault-injection (dev only), so it
// is skipped unless ACCEPTANCE_FAULTS=1:
//
//   INDEXER_FAULT_CATEGORY=fault-injection npm run dev:indexer
//   ACCEPTANCE_FAULTS=1 npm run test:acceptance
//
// Each test heals the documents it breaks, so it leaves no failed events behind.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	api,
	createDocument,
	type DocumentIndexStatus,
	runId,
	validDocument,
	type WriteAccepted,
	waitFor,
	waitIndexed,
} from "./helpers.ts";

const enabled = process.env.ACCEPTANCE_FAULTS === "1";

const status = (id: string) =>
	api<DocumentIndexStatus>("GET", `/documents/${id}/index-status`, {
		role: "editor",
	});

const failedCount = async () =>
	(
		await api<{ failed: number }>("GET", "/index/status", { role: "editor" })
	).body.failed;

/** Creates a document the injected fault makes fail, and waits until it is reported failed. */
async function createFailing() {
	const created = await createDocument({ category: "fault-injection" });
	const s = await waitFor(async () => {
		const r = await status(created.id);
		return r.body.state === "failed" ? r.body : false;
	}, "document to be reported as failed");
	return { created, failedStatus: s };
}

async function heal(id: string) {
	const put = await api<WriteAccepted>("PUT", `/documents/${id}`, {
		role: "editor",
		ifMatch: 1,
		body: validDocument({ category: `acc-recovered-${runId}` }),
	});
	assert.equal(put.status, 200);
	return waitIndexed(id, 2);
}

describe("fallos de indexación", { skip: !enabled }, () => {
	it("un error de indexación queda visible (failed + lastError) y el catálogo no se pierde", async () => {
		const { created, failedStatus } = await createFailing();
		try {
			assert.ok(failedStatus.lastError, "lastError is recorded");
			assert.equal(failedStatus.catalogVersion, 1);
			assert.equal(failedStatus.indexedVersion, null);

			const doc = await api("GET", `/documents/${created.id}`, {
				role: "editor",
			});
			assert.equal(doc.status, 200, "the catalog keeps the document");
			assert.ok((await failedCount()) >= 1);
		} finally {
			await heal(created.id);
		}
	});

	it("se recupera editando el documento a otra categoría", async () => {
		const { created } = await createFailing();
		const s = await heal(created.id);
		assert.equal(s.state, "indexed");
		assert.equal(s.lastError, null);
	});

	it("los errores no se pierden y failed baja cuando el documento se recupera", async () => {
		const { created } = await createFailing();
		const withOurs = await failedCount();
		assert.ok(withOurs >= 1);
		await heal(created.id);
		await waitFor(
			async () => (await failedCount()) <= withOurs - 1,
			"global failed count to drop after recovery",
		);
	});
});
