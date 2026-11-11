// The golden queries. Categories and tags are derived from the dataset; text queries use a
// fixed vocabulary where every word has a single inflected form in the corpus.
import type { FinalDocument } from "./dataset.ts";
import type { QuerySpec } from "./oracle.ts";

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

export function buildQueries(final: FinalDocument[]): QuerySpec[] {
	const published = final.filter((d) => d.published);
	const categories = [...new Set(published.map((d) => d.category))].sort();

	const tagCount = new Map<string, number>();
	for (const doc of published) {
		for (const tag of doc.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
	}
	const tags = [...tagCount.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([tag]) => tag);
	const [t0, t1, t2] = tags as [string, string, string];
	const c0 = categories[0] as string;

	const specs: QuerySpec[] = [];
	for (const category of categories) {
		specs.push({ name: `category:${category}`, category });
	}
	for (const tag of tags.slice(0, 6)) specs.push({ name: `tag:${tag}`, tags: [tag] });
	specs.push(
		{ name: `tags:${t0}+${t1}`, tags: [t0, t1] },
		{ name: `tags:${t1}+${t2}`, tags: [t1, t2] },
		{ name: `tags:${t0}+${t1}+${t2}`, tags: [t0, t1, t2] },
	);
	for (const word of WORDS) specs.push({ name: `text:${word}`, q: word });
	specs.push(
		// Spanish stemming: the singular finds the same documents as the plural.
		{ name: "text:incidente (stemming)", q: "incidente" },
		{ name: "text:respaldo -clúster", q: "respaldo -clúster" },
		{ name: "text:incidentes or costos", q: "incidentes or costos" },
		{ name: "text:monitoreo alertas", q: "monitoreo alertas" },
		{ name: "text:migración datos", q: "migración datos" },
		{ name: `text+category:respaldo+${c0}`, q: "respaldo", category: c0 },
		{ name: `text+tag:incidentes+${t0}`, q: "incidentes", tags: [t0] },
		{
			name: `text+category+tag:costos+${c0}+${t0}`,
			q: "costos",
			category: c0,
			tags: [t0],
		},
		{ name: "text:sin resultados", q: "zzzinexistente" },
		{ name: "tag:sin resultados", tags: [t0, "etiqueta-inexistente"] },
	);
	return specs;
}
