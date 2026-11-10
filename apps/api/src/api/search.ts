// Search over the derived index (ESC4-03, ESC4-04, ESC4-05). search_documents holds
// published documents only, so ordinary searches never return unpublished ones.
// Ordering is deterministic (id breaks ties) so pages never overlap or skip.
import type { FastifyRequest } from "fastify";
import type { Pool } from "../shared/db.ts";
import { inSpan } from "../shared/tracing.ts";
import { withTransaction } from "../shared/tx.ts";

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
				// Same snapshot for total and page.
				const { total, rows } = await withTransaction(
					pool,
					async (client) => {
						const count = await client.query<{ total: number }>(
							`SELECT count(*)::int AS total FROM search_documents ${where}`,
							values,
						);
						const page = await client.query<HitRow>(
							`SELECT id, title, description, tags, category, published_at, rank
							 FROM (SELECT *, ${rank} AS rank FROM search_documents ${where}) hits
							 ORDER BY ${orderBy}
							 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
							[...values, params.pageSize, offset],
						);
						return { total: count.rows[0]?.total ?? 0, rows: page.rows };
					},
					{ isolation: "REPEATABLE READ", readOnly: true },
				);
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
