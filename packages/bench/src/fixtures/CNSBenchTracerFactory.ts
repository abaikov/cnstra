import type { Span, SpanContext, Tracer } from '@opentelemetry/api';

/**
 * A minimal recording tracer for the tracing benchmark.
 *
 * What it is NOT: a substitute for the OpenTelemetry SDK. It does not sample,
 * batch, serialise or export anything, so the figure it produces is not the cost
 * of "running OpenTelemetry in production".
 *
 * What it IS, and why that is the more useful measurement here: it isolates what
 * CNStra itself spends when tracing is attached — the global response listener
 * running on every hop, the span-per-activation bookkeeping in
 * `attachCNSOtelTracing`, the traceparent formatting, and the context object
 * written into every activation's store. That is the part this repository can
 * regress. Exporter cost belongs to whoever configures the exporter, moves with
 * their sampling ratio, and would swamp the part being watched.
 *
 * Spans are counted and dropped, never retained: holding a million span objects
 * for the length of a benchmark would move the measurement into the garbage
 * collector.
 */
export class CNSBenchTracerFactory {
    static create(): { tracer: Tracer; spanCount: () => number } {
        let spans = 0;
        let nextId = 0;

        const makeSpan = (): Span => {
            spans++;
            nextId++;
            // Real-length W3C ids: `attachCNSOtelTracing` formats a traceparent
            // from these and a resumed run parses it back, so a short id would
            // silently take a different branch than production does.
            const spanContext: SpanContext = {
                traceId: nextId.toString(16).padStart(32, '0'),
                spanId: nextId.toString(16).padStart(16, '0'),
                traceFlags: 1,
            };
            const span = {
                spanContext: () => spanContext,
                setAttribute: () => span,
                setAttributes: () => span,
                addEvent: () => span,
                addLink: () => span,
                addLinks: () => span,
                setStatus: () => span,
                updateName: () => span,
                recordException: () => undefined,
                isRecording: () => true,
                end: () => undefined,
            };
            return span as unknown as Span;
        };

        const tracer = {
            startSpan: () => makeSpan(),
            // Present so the object satisfies the interface. `attachCNSOtelTracing`
            // never calls it — it cannot make a span the active context while a
            // dendrite body runs, which its own documentation states.
            startActiveSpan: (...args: unknown[]) => {
                const callback = args[args.length - 1] as (span: Span) => unknown;
                return callback(makeSpan());
            },
        };

        return {
            tracer: tracer as unknown as Tracer,
            spanCount: () => spans,
        };
    }
}
