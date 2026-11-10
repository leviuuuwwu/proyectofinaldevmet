// RFC 9457 problem details with correlationId (docs/contracts/openapi.yaml).
import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";

export interface ProblemInit {
	type: string;
	title: string;
	detail?: string;
	errors?: { path: string; message: string }[];
}

export function sendProblem(
	reply: FastifyReply,
	status: number,
	problem: ProblemInit,
): FastifyReply {
	return reply
		.code(status)
		.type("application/problem+json")
		.send({ ...problem, status, correlationId: reply.request.id });
}

export function registerProblemHandlers(app: FastifyInstance): void {
	app.setNotFoundHandler((_request, reply) =>
		sendProblem(reply, 404, {
			type: "/problems/not-found",
			title: "Not found",
		}),
	);

	app.setErrorHandler((error: FastifyError, request, reply) => {
		if (error.validation) {
			return sendProblem(reply, 400, {
				type: "/problems/validation",
				title: "Invalid request",
				detail: "Request does not match the contract",
				errors: error.validation.map((v) => ({
					path: `/${error.validationContext ?? "request"}${v.instancePath}`,
					message: v.message ?? "is invalid",
				})),
			});
		}
		const status = error.statusCode ?? 500;
		if (status < 500) {
			return sendProblem(reply, status, {
				type: "/problems/bad-request",
				title: "Bad request",
				detail: error.message,
			});
		}
		request.log.error(
			{ event: "request.failed", outcome: "failure", err: error },
			"request failed",
		);
		return sendProblem(reply, 500, {
			type: "/problems/internal",
			title: "Internal server error",
		});
	});
}
