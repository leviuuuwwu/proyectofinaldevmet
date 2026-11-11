// Shared helpers for acceptance tests. HTTP only: nothing here touches the database.
// Tokens are the fictitious dev tokens documented in .env.example / docs/guia-pruebas-api.md.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";

const TOKENS = {
	reader: process.env.READER_TOKEN ?? "dev-reader-token",
	editor: process.env.EDITOR_TOKEN ?? "dev-editor-token",
	admin: process.env.ADMIN_TOKEN ?? "dev-admin-token",
} as const;

export type Role = keyof typeof TOKENS;

export interface DocumentInput {
	title: string;
	description?: string;
	tags?: string[];
	category: string;
	date: string;
	status: "draft" | "published";
}

export interface DocumentDto {
	id: string;
	title: string;
	description: string;
	tags: string[];
	category: string;
	date: string;
	status: "draft" | "published" | "unpublished";
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface WriteAccepted {
	id: string;
	version: number;
	indexState: string;
}

export interface Problem {
	type: string;
	title: string;
	status: number;
	detail?: string;
	correlationId: string;
	errors?: { path: string; message: string }[];
}

export interface DocumentIndexStatus {
	docId: string;
	catalogVersion: number;
	indexedVersion: number | null;
	state: "pending" | "indexed" | "failed";
	lastError: string | null;
	committedAt: string;
	indexedAt: string | null;
}

export interface SearchHit {
	id: string;
	title: string;
	description: string;
	tags: string[];
	category: string;
	date: string;
	rank: number;
}

export interface SearchResult {
	total: number;
	page: number;
	pageSize: number;
	items: SearchHit[];
}

export interface ReindexJob {
	jobId: string;
	state: "queued" | "running" | "succeeded" | "failed";
	startedAt: string | null;
	finishedAt: string | null;
	documents: number | null;
	error: string | null;
}

export interface ApiResponse<T> {
	status: number;
	headers: Headers;
	body: T;
}

interface RequestOptions {
	/** Sends the dev token of this role. Omit both role and token for an anonymous call. */
	role?: Role;
	/** Raw bearer token, for invalid-token cases. */
	token?: string;
	body?: unknown;
	ifMatch?: string | number;
	headers?: Record<string, string>;
}

export async function api<T = unknown>(
	method: string,
	path: string,
	options: RequestOptions = {},
): Promise<ApiResponse<T>> {
	const bearer =
		options.token ?? (options.role ? TOKENS[options.role] : undefined);
	const res = await fetch(`${BASE_URL}${path}`, {
		method,
		headers: {
			...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
			...(options.body === undefined
				? {}
				: { "content-type": "application/json" }),
			...(options.ifMatch === undefined
				? {}
				: { "if-match": String(options.ifMatch) }),
			...options.headers,
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await res.text();
	const isJson = (res.headers.get("content-type") ?? "").includes("json");
	return {
		status: res.status,
		headers: res.headers,
		body: (isJson && text ? JSON.parse(text) : text) as T,
	};
}

/** Unique per run, so tests never depend on (or collide with) data already in the database. */
export const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

/** A lowercase letters-only token that Spanish stemming leaves untouched. */
export function uniqueWord(prefix = "zq"): string {
	const letters = randomBytes(6)
		.toString("hex")
		.replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)] as string);
	return `${prefix}${letters}x`;
}

export function validDocument(overrides: Partial<DocumentInput> = {}) {
	return {
		title: `Guía ${uniqueWord()}`,
		description: "Documento ficticio de pruebas de aceptación.",
		tags: ["acceptance"],
		category: `acc-${runId}`,
		date: "2026-06-01T00:00:00.000Z",
		status: "published",
		...overrides,
	} satisfies DocumentInput;
}

/** Creates a document as editor and asserts the 201. */
export async function createDocument(
	overrides: Partial<DocumentInput> = {},
): Promise<WriteAccepted> {
	const res = await api<WriteAccepted>("POST", "/documents", {
		role: "editor",
		body: validDocument(overrides),
	});
	assert.equal(res.status, 201, JSON.stringify(res.body));
	return res.body;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns a truthy value; fails with `message` after `timeoutMs`. */
export async function waitFor<T>(
	fn: () => Promise<T | false | null | undefined>,
	message: string,
	timeoutMs = 20_000,
	intervalMs = 150,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() >= deadline) assert.fail(`Timed out: ${message}`);
		await sleep(intervalMs);
	}
}

/** Waits until the index has applied at least `version` of the document. */
export async function waitIndexed(
	id: string,
	version = 1,
): Promise<DocumentIndexStatus> {
	return waitFor(async () => {
		const res = await api<DocumentIndexStatus>(
			"GET",
			`/documents/${id}/index-status`,
			{ role: "editor" },
		);
		assert.equal(res.status, 200);
		return res.body.state === "indexed" &&
			(res.body.indexedVersion ?? 0) >= version
			? res.body
			: false;
	}, `document ${id} v${version} to be indexed`);
}

export function waitAllIndexed(docs: WriteAccepted[]) {
	return Promise.all(docs.map((d) => waitIndexed(d.id, d.version)));
}

export function search(query: Record<string, string | string[]>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		for (const v of Array.isArray(value) ? value : [value]) {
			params.append(key, v);
		}
	}
	return api<SearchResult>("GET", `/search?${params}`, { role: "reader" });
}

/** RFC 9457 problem+json with a correlationId that matches the response header. */
export function assertProblem(
	res: ApiResponse<unknown>,
	status: number,
	type?: string,
): Problem {
	assert.equal(res.status, status, JSON.stringify(res.body));
	assert.match(
		res.headers.get("content-type") ?? "",
		/application\/problem\+json/,
	);
	const body = res.body as Problem;
	assert.equal(body.status, status);
	assert.equal(typeof body.title, "string");
	assert.ok(body.correlationId, "problem has correlationId");
	assert.equal(body.correlationId, res.headers.get("x-correlation-id"));
	if (type) assert.equal(body.type, type);
	return body;
}

export const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const NIL_UUID = "00000000-0000-4000-8000-000000000000";
