// Bearer token auth with hierarchical roles (admin ⊃ editor ⊃ reader).
// Tokens are compared by SHA-256 in constant time; plaintext is never stored or logged.
import { createHash, timingSafeEqual } from "node:crypto";
import type {
	FastifyReply,
	FastifyRequest,
	onRequestHookHandler,
} from "fastify";
import type { AuthToken, Role } from "./config.ts";
import { sendProblem } from "./problem.ts";

export interface Principal {
	sub: string;
	role: Role;
}

declare module "fastify" {
	interface FastifyRequest {
		principal: Principal | null;
	}
}

const RANK: Record<Role, number> = { reader: 1, editor: 2, admin: 3 };

export function hasRole(principal: Principal, required: Role): boolean {
	return RANK[principal.role] >= RANK[required];
}

export function authenticate(
	authorization: string | undefined,
	tokens: readonly AuthToken[],
): Principal | null {
	const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
	if (!match?.[1]) return null;
	const hash = createHash("sha256").update(match[1]).digest();
	let found: AuthToken | null = null;
	// No early exit: every entry is compared.
	for (const token of tokens) {
		if (timingSafeEqual(hash, token.sha256) && found === null) found = token;
	}
	return found && { sub: found.sub, role: found.role };
}

export function requireRole(
	required: Role,
	tokens: readonly AuthToken[],
): onRequestHookHandler {
	return (request: FastifyRequest, reply: FastifyReply, done) => {
		const principal = authenticate(request.headers.authorization, tokens);
		if (!principal) {
			request.log.warn(
				{
					event: "auth.rejected",
					outcome: "failure",
					reason: "unauthenticated",
				},
				"missing or invalid token",
			);
			reply.header("www-authenticate", "Bearer");
			sendProblem(reply, 401, {
				type: "/problems/unauthorized",
				title: "Unauthorized",
			});
			return;
		}
		if (!hasRole(principal, required)) {
			request.log.warn(
				{
					event: "auth.rejected",
					outcome: "failure",
					reason: "forbidden",
					role: principal.role,
					requiredRole: required,
				},
				"insufficient role",
			);
			sendProblem(reply, 403, {
				type: "/problems/forbidden",
				title: "Forbidden",
				detail: `Role '${principal.role}' cannot perform this operation`,
			});
			return;
		}
		request.principal = principal;
		done();
	};
}
