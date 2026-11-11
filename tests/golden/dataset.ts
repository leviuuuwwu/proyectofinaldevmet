// Deterministic golden dataset. Same SEED/COUNT → same documents and same changes, always.
// It reuses the datagen generator, so its first COUNT documents are the first COUNT of the
// 2,000 that `npm start -w tools/datagen` loads (ESC4-10).
import {
	createRng,
	type DocumentInput,
	generateDocument,
	generateDocuments,
} from "../../tools/datagen/src/data.ts";

export const SEED = 42;
export const COUNT = 2000;

export type Change =
	| { index: number; kind: "update"; doc: DocumentInput }
	| { index: number; kind: "unpublish" };

/** Final state of a document after all changes. `index` is its position in the dataset. */
export interface FinalDocument {
	index: number;
	title: string;
	description: string;
	tags: string[];
	category: string;
	date: string;
	published: boolean;
}

export function buildDataset(): {
	created: DocumentInput[];
	changes: Change[];
	final: FinalDocument[];
} {
	const created = generateDocuments(createRng(SEED), COUNT);

	// A separate generator for the changes, so they never shift the base dataset.
	const changeRng = createRng(SEED + 1);
	const changes: Change[] = [];
	for (let index = 0; index < COUNT; index++) {
		if (index % 20 === 3) {
			changes.push({ index, kind: "update", doc: generateDocument(changeRng) });
		} else if (index % 20 === 7) {
			changes.push({ index, kind: "unpublish" });
		}
	}

	const final: FinalDocument[] = created.map((doc, index) => ({
		index,
		title: doc.title,
		description: doc.description,
		tags: doc.tags,
		category: doc.category,
		date: doc.date,
		published: doc.status === "published",
	}));
	for (const change of changes) {
		const target = final[change.index] as FinalDocument;
		if (change.kind === "update") {
			target.title = change.doc.title;
			target.description = change.doc.description;
			target.tags = change.doc.tags;
			target.category = change.doc.category;
			target.date = change.doc.date;
			target.published = change.doc.status === "published";
		} else {
			target.published = false;
		}
	}
	return { created, changes, final };
}
