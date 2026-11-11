// Search over the derived index (ESC4-03, ESC4-04, ESC4-05). search_documents holds
// published documents only, so ordinary searches never return unpublished ones.
// Ordering is deterministic (id breaks ties) so pages never overlap or skip.
import type { FastifyRequest } from "fastify";
import type { Pool } from "../shared/db.ts";
import { inSpan } from "../shared/tracing.ts";

export interface SearchParams {
	q?: string;
	tags?: string[];
	category?: string;
	sort: "relevance" | "date";
	page: number;
	pageSize: number;
}

interface HitRow {
	id: string;
	title: string;
	description: string;
	tags: string[];
	category: string;
	published_at: Date;
	rank: number;
}

export function buildOrderBy(
	sort: SearchParams["sort"],
	hasText: boolean,
): string {
	return sort === "relevance" && hasText
		? "rank DESC, published_at DESC, id ASC"
		: "published_at DESC, id ASC";
}

// Parameterized WHERE clause and rank expression; user input never reaches the SQL text.
export function buildSearchSql(params: SearchParams): {
	where: string;
	rank: string;
	values: unknown[];
} {
	const values: unknown[] = [];
	const conditions: string[] = [];
	let rank = "0::float4";
	if (params.q !== undefined) {
		values.push(params.q);
		const tsquery = `websearch_to_tsquery('spanish', $${values.length})`;
		conditions.push(`tsv @@ ${tsquery}`);
		rank = `ts_rank(tsv, ${tsquery})`;
	}
	if (params.tags && params.tags.length > 0) {
		values.push(params.tags);
		conditions.push(`tags @> $${values.length}::text[]`);
	}
	if (params.category !== undefined) {
		values.push(params.category);
		conditions.push(`category = $${values.length}`);
	}
	return {
		where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
		rank,
		values,
	};
}

export function searchHandler(pool: Pool) {
	return async (request: FastifyRequest<{ Querystring: SearchParams }>) => {
		const params = request.query;
		const hasText = params.q !== undefined;
		const filters =
			(params.tags?.length ? 1 : 0) + (params.category !== undefined ? 1 : 0);
		return inSpan(
			"search.query",
			{
				attributes: {
					"search.has_text": hasText,
					"search.filters": filters,
					"search.page": params.page,
					"search.page_size": params.pageSize,
				},
			},
			async (span) => {
				const { where, rank, values } = buildSearchSql(params);
				const orderBy = buildOrderBy(params.sort, hasText);
				const offset = (params.page - 1) * params.pageSize;
				// One READ COMMITTED statement: total (window count) and page share the
				// statement snapshot, which is taken after table locks are acquired. A
				// REPEATABLE READ transaction would fix its snapshot before waiting on the
				// rebuild's rename and then read the new table as empty (ESC4-07).
				const page = await pool.query<HitRow & { total: number }>(
					`SELECT id, title, description, tags, category, published_at, rank,
					        count(*) OVER ()::int AS total
					 FROM (SELECT *, ${rank} AS rank FROM search_documents ${where}) hits
					 ORDER BY ${orderBy}
					 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
					[...values, params.pageSize, offset],
				);
				const rows = page.rows;
				// A page past the end has no rows to carry the window count.
				const total =
					rows[0]?.total ??
					(offset === 0
						? 0
						: ((
								await pool.query<{ total: number }>(
									`SELECT count(*)::int AS total FROM search_documents ${where}`,
									values,
								)
							).rows[0]?.total ?? 0));
				span.setAttribute("search.total", total);
				return {
					total,
					page: params.page,
					pageSize: params.pageSize,
					items: rows.map((row) => ({
						id: row.id,
						title: row.title,
						description: row.description,
						tags: row.tags,
						category: row.category,
						date: row.published_at.toISOString(),
						rank: row.rank,
					})),
				};
			},
		);
	};
}
