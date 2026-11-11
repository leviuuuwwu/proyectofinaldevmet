// Acceptance: authentication and hierarchical roles (admin ⊃ editor ⊃ reader), COM-01.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	api,
	assertProblem,
	NIL_UUID,
	type Role,
	validDocument,
} from "./helpers.ts";

interface Route {
	name: string;
	method: string;
	path: string;
	minRole: Role;
	body?: unknown;
	ifMatch?: string;
}

const ROUTES: Route[] = [
	{
		name: "POST /documents",
		method: "POST",
		path: "/documents",
		minRole: "editor",
		body: validDocument(),
	},
	{
		name: "GET /documents/{id}",
		method: "GET",
		path: `/documents/${NIL_UUID}`,
		minRole: "editor",
	},
	{
		name: "PUT /documents/{id}",
		method: "PUT",
		path: `/documents/${NIL_UUID}`,
		minRole: "editor",
		body: validDocument(),
		ifMatch: "1",
	},
	{
		name: "POST /documents/{id}/unpublish",
		method: "POST",
		path: `/documents/${NIL_UUID}/unpublish`,
		minRole: "editor",
	},
	{
		name: "GET /documents/{id}/index-status",
		method: "GET",
		path: `/documents/${NIL_UUID}/index-status`,
		minRole: "editor",
	},
	{
		name: "GET /index/status",
		method: "GET",
		path: "/index/status",
		minRole: "editor",
	},
	{
		name: "GET /search",
		method: "GET",
		path: "/search?q=prueba",
		minRole: "reader",
	},
	{
		name: "GET /admin/reindex/{jobId}",
		method: "GET",
		path: `/admin/reindex/${NIL_UUID}`,
		minRole: "admin",
	},
];

const RANK: Record<Role, number> = { reader: 1, editor: 2, admin: 3 };

const call = (route: Route, auth: { role?: Role; token?: string }) =>
	api(route.method, route.path, {
		...auth,
		body: route.body,
		ifMatch: route.ifMatch,
	});

describe("401: sin token o token inválido", () => {
	for (const route of ROUTES) {
		it(`${route.name} sin token → 401`, async () => {
			const res = await call(route, {});
			assertProblem(res, 401, "/problems/unauthorized");
			assert.equal(res.headers.get("www-authenticate"), "Bearer");
		});

		it(`${route.name} con token inválido → 401`, async () => {
			const res = await call(route, { token: "not-a-real-token" });
			assertProblem(res, 401, "/problems/unauthorized");
		});
	}

	it("POST /admin/reindex sin token → 401", async () => {
		assertProblem(await api("POST", "/admin/reindex"), 401);
	});

	it("esquema distinto de Bearer → 401", async () => {
		// Credencial Basic armada en tiempo de ejecución (no como literal) para no
		// disparar los escáneres de secretos; el contenido es ficticio.
		const basic = Buffer.from(["fake", "credential"].join(":")).toString(
			"base64",
		);
		const res = await api("GET", "/search?q=prueba", {
			headers: { authorization: `Basic ${basic}` },
		});
		assertProblem(res, 401);
	});

	it("el 401 no revela el token enviado", async () => {
		const res = await api("GET", "/search?q=prueba", { token: "secret-xyz-123" });
		assert.ok(!JSON.stringify(res.body).includes("secret-xyz-123"));
	});
});

describe("403: rol insuficiente", () => {
	for (const route of ROUTES) {
		for (const role of ["reader", "editor", "admin"] as const) {
			const allowed = RANK[role] >= RANK[route.minRole];
			it(`${route.name} como ${role} → ${allowed ? "autorizado" : "403"}`, async () => {
				const res = await call(route, { role });
				if (allowed) {
					// Authorized: the request reaches the handler (404 for the nil id, etc.).
					assert.notEqual(res.status, 401);
					assert.notEqual(res.status, 403);
				} else {
					assertProblem(res, 403, "/problems/forbidden");
				}
			});
		}
	}

	it("POST /admin/reindex como editor → 403 (no se inicia ninguna reconstrucción)", async () => {
		assertProblem(await api("POST", "/admin/reindex", { role: "editor" }), 403);
	});

	it("POST /admin/reindex como reader → 403", async () => {
		assertProblem(await api("POST", "/admin/reindex", { role: "reader" }), 403);
	});
});

describe("correlationId", () => {
	it("se respeta un X-Correlation-Id válido en un error de autenticación", async () => {
		const id = "acceptance-corr-0001";
		const res = await api("GET", "/search?q=prueba", {
			headers: { "x-correlation-id": id },
		});
		assert.equal(res.status, 401);
		assert.equal(res.headers.get("x-correlation-id"), id);
		assert.equal((res.body as { correlationId: string }).correlationId, id);
	});

	it("se genera uno nuevo si el recibido no es válido", async () => {
		const res = await api("GET", "/search?q=prueba", {
			headers: { "x-correlation-id": "no valido!" },
		});
		assert.equal(res.status, 401);
		assert.notEqual(res.headers.get("x-correlation-id"), "no valido!");
		assert.ok(res.headers.get("x-correlation-id"));
	});
});
