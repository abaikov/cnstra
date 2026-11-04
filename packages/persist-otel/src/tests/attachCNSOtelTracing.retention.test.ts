import { trace } from '@opentelemetry/api';
import type { Context, Span, SpanOptions, Tracer } from '@opentelemetry/api';
import { CNS, collateral, neuron } from '@cnstra/core';

import { attachCNSOtelTracing } from '.././attachCNSOtelTracing';

/**
 * What the tracer keeps hold of while a run is alive.
 *
 * It maps `(neuron, the signal it consumes) → span`, and the entry cannot be
 * deleted when the span closes: an activation that emits an ARRAY of signals
 * answers once per signal, and every one of those children belongs under the
 * same span. In a strong map that meant the signal object, its payload and the
 * closed span stayed pinned for the whole run — measured at 2.33 kB a hop, so
 * 18 MB at eight thousand hops and no bound at all on a cyclic run, against a
 * few dozen kB for the same run untraced.
 *
 * The inner map is weak now, so an entry lives exactly as long as the engine
 * still holds the signal — which is exactly as long as that activation can still
 * answer. Measured at the last hop of a self-loop, traced minus untraced, with a
 * forced collection: 2332 bytes a hop before, 23 after, and 18139 kB against
 * 176 kB at eight thousand hops.
 *
 * What is pinned HERE is the half that can be asserted rather than weighed: the
 * open set, which is the only thing still iterated and the only thing that could
 * silently put the retention back. A `WeakRef` cannot answer it — one created in
 * the current job is kept alive until that job ends, so asking from inside a
 * response listener reports everything alive whatever the truth is.
 */

const tinyTracer = (): { tracer: Tracer; ends: () => number } => {
    let next = 0;
    let ends = 0;
    const make = (name: string, options?: SpanOptions, ctx?: Context): Span => {
        const spanId = (++next).toString(16).padStart(16, '0');
        const parent = ctx ? trace.getSpan(ctx) : undefined;
        const spanContext = {
            traceId: parent?.spanContext().traceId ?? spanId.repeat(2),
            spanId,
            traceFlags: 1,
        };
        const span = {
            name,
            attributes: { ...(options?.attributes ?? {}) },
            spanContext: () => spanContext,
            setStatus: () => span,
            setAttribute: () => span,
            setAttributes: () => span,
            addEvent: () => span,
            addLink: () => span,
            addLinks: () => span,
            recordException: () => span,
            updateName: () => span,
            end: () => {
                ends++;
            },
            isRecording: () => true,
        } as unknown as Span;
        return span;
    };
    return {
        tracer: {
            startSpan: make,
            startActiveSpan: ((...args: unknown[]) => {
                const fn = args[args.length - 1] as (s: Span) => unknown;
                return fn(make(args[0] as string));
            }) as Tracer['startActiveSpan'],
        },
        ends: () => ends,
    };
};

/**
 * A self-loop that runs `hops` times: one neuron, one collateral, counting up.
 *
 * The same neuron over and over is the case the map is hardest on — every hop
 * lands in the SAME inner map, so a strong one grows by the length of the run
 * rather than by the width of the graph.
 */
/** A forced collection, so what is read is live rather than merely uncollected. */
const collect = (): boolean => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) return false;
    for (let i = 0; i < 3; i++) gc();
    return true;
};

const liveHeap = (): number => {
    collect();
    return process.memoryUsage().heapUsed;
};

const loop = (hops: number) => {
    const tick = collateral<{ n: number }>();
    const done = collateral<{ n: number }>();
    const looper = neuron({ tick, done }).dendrite({
        collateral: tick,
        response: (p, axon) =>
            p!.n >= hops
                ? axon.done.createSignal({ n: p!.n })
                : axon.tick.createSignal({ n: p!.n + 1 }),
    });
    const sink = neuron({}).dendrite({
        collateral: done,
        response: () => undefined,
    });
    return { cns: new CNS([looper, sink]), tick };
};

describe('what the tracer holds while a run is alive', () => {
    it('does not grow with the length of the run', async () => {
        // The number this whole change is about. Three states, same probe:
        //
        //   strong map, no drain    2332 bytes a hop
        //   weak map, no drain      1691
        //   weak map, drained          23
        //
        // So the threshold sits an order of magnitude from both the pass and the
        // fail, which is what makes a heap assertion worth having here.
        if (!collect()) {
            // eslint-disable-next-line no-console
            console.warn(
                '[persist-otel] retention case needs --expose-gc; not run'
            );
            return;
        }

        const hops = 4_000;
        const flow = loop(hops);
        const handle = attachCNSOtelTracing(flow.cns as never, {
            tracer: tinyTracer().tracer,
        });

        let heldAtLastHop = 0;
        const baseline = liveHeap();
        await flow.cns
            .stimulate(flow.tick.createSignal({ n: 0 }), {
                onResponse: response => {
                    // At the last hop everything the run will ever hold is held.
                    if (response.queueLength === 0)
                        heldAtLastHop = liveHeap() - baseline;
                },
            })
            .waitUntilComplete();
        handle.detach();

        expect(heldAtLastHop / hops).toBeLessThan(300);
    });

    it('still ends what is genuinely open when detached mid-run', async () => {
        // The other half: draining must not leave detach with nothing to do when
        // there IS something.
        const t = tinyTracer();
        const input = collateral<{ n: number }>();
        const out = collateral<{ n: number }>();
        let release: (() => void) | undefined;
        const slow = neuron({ out }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                await new Promise<void>(resolve => {
                    release = resolve;
                });
                return axon.out.createSignal({ n: p!.n });
            },
        });
        const sink = neuron({}).dendrite({
            collateral: out,
            response: () => undefined,
        });
        const cns = new CNS([slow, sink]);
        const handle = attachCNSOtelTracing(cns as never, { tracer: t.tracer });

        const running = cns
            .stimulate(input.createSignal({ n: 1 }))
            .waitUntilComplete();
        // Let the neuron park inside its response.
        await new Promise(resolve => setTimeout(resolve, 5));

        const before = t.ends();
        handle.detach();
        expect(t.ends()).toBeGreaterThan(before);

        release?.();
        await running;
    });

});
