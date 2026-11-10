// Manual spans of docs/contracts/telemetry.md and W3C traceparent helpers used to
// link the indexer span to the API span through the outbox row.
import {
	context,
	isSpanContextValid,
	type Link,
	propagation,
	ROOT_CONTEXT,
	type Span,
	type SpanOptions,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";

const tracer = trace.getTracer("search");

export async function inSpan<T>(
	name: string,
	options: SpanOptions,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return tracer.startActiveSpan(name, options, async (span) => {
		try {
			return await fn(span);
		} catch (err) {
			span.recordException(err as Error);
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw err;
		} finally {
			span.end();
		}
	});
}

export function currentTraceparent(): string | null {
	const carrier: Record<string, string> = {};
	propagation.inject(context.active(), carrier);
	return carrier.traceparent ?? null;
}

export function linkFrom(traceparent: string | null | undefined): Link | null {
	if (!traceparent) return null;
	const spanContext = trace.getSpanContext(
		propagation.extract(ROOT_CONTEXT, { traceparent }),
	);
	return spanContext && isSpanContextValid(spanContext)
		? { context: spanContext }
		: null;
}
