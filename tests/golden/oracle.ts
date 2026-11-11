// Independent oracle: computes the expected search results in plain JavaScript from the
// final dataset, without PostgreSQL. It models only what is safe to model (see
// docs/guia-pruebas-api.md): set membership, `total` and the date ordering. It does NOT
// reproduce `rank`, which depends on PostgreSQL.
import type { FinalDocument } from "./dataset.ts";

export interface QuerySpec {
	name: string;
	q?: string;
	tags?: string[];
	category?: string;
}

/** Expected result: `groups` are the documents grouped by equal date, newest date first. */
export interface Expected {
	total: number;
	groups: number[][];
}

// Controlled vocabulary: each queried word appears in the corpus either in a single form, or
// in the forms listed below. PostgreSQL's Spanish stemming treats the forms of a group as the
// same term ('incidente' = 'incidentes'), so the oracle needs that table and nothing else.
const STEM_GROUPS: string[][] = [["incidente", "incidentes"]];
const formsOf = (term: string) =>
	STEM_GROUPS.find((group) => group.includes(term)) ?? [term];
const tokens = (text: string) =>
	new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));

/** websearch semantics for the subset we use: `a b` = AND, `a or b` = OR, `-a` = NOT. */
function textMatches(doc: FinalDocument, q: string): boolean {
	const have = tokens(`${doc.title} ${doc.description}`);
	return q
		.toLowerCase()
		.split(/\s+or\s+/)
		.some((group) =>
			group
				.split(/\s+/)
				.filter(Boolean)
				.every((term) => {
					const negated = term.startsWith("-");
					const present = formsOf(negated ? term.slice(1) : term).some((f) =>
						have.has(f),
					);
					return negated ? !present : present;
				}),
		);
}

export function matches(doc: FinalDocument, spec: QuerySpec): boolean {
	if (!doc.published) return false;
	if (spec.category !== undefined && doc.category !== spec.category) {
		return false;
	}
	if (spec.tags && !spec.tags.every((t) => doc.tags.includes(t))) return false;
	if (spec.q !== undefined && !textMatches(doc, spec.q)) return false;
	return true;
}

export function expectedFor(
	spec: QuerySpec,
	final: FinalDocument[],
): Expected {
	const hits = final
		.filter((doc) => matches(doc, spec))
		.sort(
			(a, b) =>
				Date.parse(b.date) - Date.parse(a.date) || a.index - b.index,
		);
	const groups: number[][] = [];
	let currentDate = "";
	for (const doc of hits) {
		if (doc.date !== currentDate || groups.length === 0) {
			groups.push([]);
			currentDate = doc.date;
		}
		(groups.at(-1) as number[]).push(doc.index);
	}
	// Within a date the API breaks ties by (random) id, so order inside a group is a set.
	for (const g of groups) g.sort((a, b) => a - b);
	return { total: hits.length, groups };
}

/** Compact, stable text form for the committed fixture: groups split by `|`, items by `,`. */
export function encode(expected: Expected): { total: number; order: string } {
	return {
		total: expected.total,
		order: expected.groups.map((g) => g.join(",")).join("|"),
	};
}

export function decode(entry: { total: number; order: string }): Expected {
	return {
		total: entry.total,
		groups: entry.order
			? entry.order.split("|").map((g) => g.split(",").map(Number))
			: [],
	};
}
