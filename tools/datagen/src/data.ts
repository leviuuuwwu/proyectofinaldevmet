// Deterministic fictitious data. Same SEED → same dataset (ESC4-10).

/** mulberry32: small seeded PRNG. Never use Math.random here. */
export function createRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface DocumentInput {
	title: string;
	description: string;
	tags: string[];
	category: string;
	date: string;
	status: "draft" | "published";
}

const CATEGORIES = [
	"operaciones",
	"seguridad",
	"desarrollo",
	"datos",
	"redes",
	"finanzas",
	"legal",
	"soporte",
];

const TAGS = [
	"postgres",
	"respaldo",
	"restauracion",
	"kubernetes",
	"docker",
	"monitoreo",
	"alertas",
	"seguridad",
	"auditoria",
	"api",
	"indice",
	"busqueda",
	"rendimiento",
	"migracion",
	"politica",
	"incidente",
	"red",
	"costos",
	"cumplimiento",
	"capacitacion",
];

const SUBJECTS = [
	"bases de datos",
	"clúster de producción",
	"servicio de búsqueda",
	"catálogo de documentos",
	"pipeline de entrega",
	"sistema de monitoreo",
	"política de acceso",
	"red interna",
	"índice de texto",
	"cola de eventos",
];

const KINDS = [
	"Guía de",
	"Procedimiento de",
	"Manual de",
	"Informe de",
	"Checklist de",
	"Plan de",
	"Resumen de",
	"Lecciones aprendidas de",
];

const TOPICS = [
	"respaldo y restauración",
	"actualización de versión",
	"respuesta a incidentes",
	"control de costos",
	"ajuste de rendimiento",
	"migración de datos",
	"gestión de accesos",
	"auditoría de cambios",
	"alertas y guardias",
	"capacitación del equipo",
];

const SENTENCES = [
	"Describe los pasos necesarios para completar la tarea sin interrumpir el servicio.",
	"Incluye responsables, tiempos estimados y criterios de verificación.",
	"Se recomienda validar los resultados en el ambiente de desarrollo antes de producción.",
	"El procedimiento fue revisado por el equipo de operaciones y se actualiza cada trimestre.",
	"Ante cualquier error, registrar el incidente y notificar al responsable de guardia.",
	"Los datos de ejemplo son ficticios y no contienen información real.",
	"Consulta también las métricas y los tableros asociados para dar seguimiento.",
];

const pick = <T>(rng: () => number, list: readonly T[]): T =>
	list[Math.floor(rng() * list.length)] as T;

function pickMany(rng: () => number, list: readonly string[], n: number) {
	const pool = [...list];
	const out: string[] = [];
	while (out.length < n && pool.length > 0) {
		out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] as string);
	}
	return out;
}

const DAY_MS = 86_400_000;
// Fixed anchor so dates do not depend on the clock.
const BASE_DATE = Date.UTC(2026, 0, 1);

export function generateDocument(rng: () => number): DocumentInput {
	const title = `${pick(rng, KINDS)} ${pick(rng, TOPICS)} en ${pick(rng, SUBJECTS)}`;
	const description = [pick(rng, SENTENCES), pick(rng, SENTENCES)].join(" ");
	const tags = pickMany(rng, TAGS, 1 + Math.floor(rng() * 4)); // 1–4 ≤ 10
	const date = new Date(BASE_DATE + Math.floor(rng() * 300) * DAY_MS);
	return {
		title,
		description,
		tags,
		category: pick(rng, CATEGORIES),
		date: date.toISOString(),
		// ~90 % published so search has content; the rest stay as drafts.
		status: rng() < 0.9 ? "published" : "draft",
	};
}

export function generateDocuments(rng: () => number, n: number) {
	return Array.from({ length: n }, () => generateDocument(rng));
}
