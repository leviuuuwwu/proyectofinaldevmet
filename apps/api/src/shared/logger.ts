// JSON logger with the fields of docs/contracts/telemetry.md.
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { type Logger, pino } from "pino";
import type { Component } from "./config.ts";

export type { Logger };

export function createLogger(component: Component, level: string): Logger {
	return pino({
		level,
		base: { component },
		messageKey: "msg",
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: { level: (label) => ({ level: label }) },
		// Path only: the query string may contain search text.
		serializers: {
			req: (req: { method: string; url: string }) => ({
				method: req.method,
				path: req.url.split("?")[0],
			}),
			res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
			err: pino.stdSerializers.err,
		},
		redact: {
			paths: ["req.headers.authorization", "headers.authorization"],
			censor: "[redacted]",
		},
		mixin() {
			const ctx = trace.getActiveSpan()?.spanContext();
			return ctx && isSpanContextValid(ctx)
				? { traceId: ctx.traceId, spanId: ctx.spanId }
				: {};
		},
	});
}
