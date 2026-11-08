// Request schemas mirroring docs/contracts/openapi.yaml (the contract wins on conflict).

const tag = { type: "string", pattern: "^[a-z0-9-]{1,40}$" } as const;
const category = { type: "string", minLength: 1, maxLength: 50 } as const;
const uuid = { type: "string", format: "uuid" } as const;

export const documentInput = {
	type: "object",
	additionalProperties: false,
	required: ["title", "category", "date", "status"],
	properties: {
		title: { type: "string", minLength: 1, maxLength: 200 },
		description: { type: "string", maxLength: 2000, default: "" },
		tags: {
			type: "array",
			maxItems: 10,
			uniqueItems: true,
			default: [],
			items: tag,
		},
		category,
		date: { type: "string", format: "date-time" },
		status: { type: "string", enum: ["draft", "published"] },
	},
} as const;

export const documentIdParams = {
	type: "object",
	required: ["id"],
	properties: { id: uuid },
} as const;

export const jobIdParams = {
	type: "object",
	required: ["jobId"],
	properties: { jobId: uuid },
} as const;

export const ifMatchHeaders = {
	type: "object",
	required: ["if-match"],
	properties: { "if-match": { type: "string", pattern: '^"?[1-9][0-9]*"?$' } },
} as const;

export const searchQuery = {
	type: "object",
	additionalProperties: false,
	properties: {
		q: { type: "string", minLength: 1, maxLength: 200 },
		tags: { type: "array", maxItems: 10, items: tag },
		category,
		sort: { type: "string", enum: ["relevance", "date"], default: "relevance" },
		page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
		pageSize: { type: "integer", minimum: 1, maximum: 50, default: 20 },
	},
} as const;
