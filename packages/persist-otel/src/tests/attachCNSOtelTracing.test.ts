import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Context, Span, SpanOptions, Tracer } from '@opentelemetry/api';
import { CNS, collateral, neuron } from '@cnstra/core';

import { attachCNSOtelTracing, CNS_OTEL_CONTEXT } from '.././attachCNSOtelTracing';
import type { TCNSOtelCompartment } from '.././attachCNSOtelTracing';

/**
 * The tree is built AHEAD of the work: the root opens on the entry injection, and
 * a neuron's children are opened the moment it answers — the subscriber map
 * already names them — so a span exists before the activation it describes runs.
 *
 * These pin the shape that comes out, and the two cases that broke it while it
 * was being written: an activation that emits an ARRAY (several responses, one
 * activation) and two neurons listening to the same collateral.
 */

type TRecorded = {
    name: string;
    parent?: string;
    /** Modelled, not fixed: a root starts a trace, a child inherits its parent's. */
    traceId: string;
    spanId: string;
    status?: SpanStatusCode;
    ended: boolean;
    endTime?: number;
};

const fakeTracer = () => {
    const spans: TRecorded[] = [];
    const byId = new Map<string, TRecorded>();
    let next = 0;

    const tracer: Tracer = {
        startSpan(name: string, _options?: SpanOptions, ctx?: Context): Span {
            const id = `${(++next).toString(16).padStart(16, '0')}`;
            const parent = ctx ? trace.getSpan(ctx) : undefined;
            const parentContext = parent?.spanContext();
            const recorded: TRecorded = {
                name,
                parent: parentContext
                    ? byId.get(parentContext.spanId)?.name
                    : undefined,
                // A child stays in its parent's trace — including a REMOTE parent
                // rebuilt from a traceparent, which is how a Retry rejoins.
                traceId:
                    parentContext?.traceId ??
                    `${next.toString(16).padStart(32, '0')}`,
                spanId: id,
                ended: false,
            };
            spans.push(recorded);

            const span = {
                spanContext: () => ({
                    traceId: recorded.traceId,
                    spanId: id,
                    traceFlags: 1,
                }),
                setAttribute: () => span,
                setAttributes: () => span,
                addEvent: () => span,
                addLink: () => span,
                addLinks: () => span,
                setStatus: (s: { code: SpanStatusCode }) => {
                    recorded.status = s.code;
                    return span;
                },
                updateName: () => span,
                end: (endTime?: number) => {
                    recorded.ended = true;
                    recorded.endTime = endTime;
                },
                isRecording: () => !recorded.ended,
                recordException: () => {},
            } as unknown as Span;

            byId.set(id, recorded);
            return span;
        },
        startActiveSpan: (() => {
            throw new Error('not used');
        }) as never,
    };

    return { tracer, spans };
};

/** A flow: input → n1 → mid → n2 → out → n3. */
const buildFlow = () => {
    const input = collateral<{ id: number }>();
    const mid = collateral<{ id: number }>();
    const out = collateral<{ ok: boolean }>();

    const n1 = neuron({ mid }).dendrite({
        collateral: input,
        response: (p, axon) => axon.mid.createSignal({ id: p!.id }),
    });
    const n2 = neuron({ out }).dendrite({
        collateral: mid,
        response: (_p, axon) => axon.out.createSignal({ ok: true }),
    });
    const n3 = neuron({}).dendrite({
        collateral: out,
        response: () => undefined,
    });

    const names = new Map<object, string>([
        [n1 as object, 'n1'],
        [n2 as object, 'n2'],
        [n3 as object, 'n3'],
    ]);
    const colNames = new Map<object, string>([
        [input as object, 'input'],
        [mid as object, 'mid'],
        [out as object, 'out'],
    ]);

    return {
        cns: new CNS([n1, n2, n3]),
        input,
        out,
        n3,
        names,
        colNames,
        neuronName: (n: object) => names.get(n),
        collateralName: (c: object) => colNames.get(c),
    };
};

describe('attachCNSOtelTracing', () => {
    it('opens the root on the entry injection, before any neuron runs', async () => {
        const flow = buildFlow();
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(flow.cns as never, {
            tracer,
            neuronName: flow.neuronName as never,
            collateralName: flow.collateralName as never,
        });

        // The listener has already fired for the entry by the time stimulate
        // returns — the root and the first activation's span exist before the run
        // has settled.
        const stimulation = flow.cns.stimulate(
            flow.input.createSignal({ id: 1 })
        );
        expect(spans[0].name).toBe('input');
        expect(spans[0].parent).toBeUndefined();

        await stimulation.waitUntilComplete();
    });

    it('names each span after its neuron and hangs it off its producer', async () => {
        const flow = buildFlow();
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(flow.cns as never, {
            tracer,
            neuronName: flow.neuronName as never,
            collateralName: flow.collateralName as never,
        });

        await flow.cns
            .stimulate(flow.input.createSignal({ id: 1 }))
            .waitUntilComplete();

        const parents = Object.fromEntries(spans.map(s => [s.name, s.parent]));
        expect(parents).toEqual({
            input: undefined,
            n1: 'input',
            n2: 'n1',
            n3: 'n2',
        });
    });

    it('ends every span it opened', async () => {
        const flow = buildFlow();
        const { tracer, spans } = fakeTracer();
        const handle = attachCNSOtelTracing(flow.cns as never, {
            tracer,
            neuronName: flow.neuronName as never,
            collateralName: flow.collateralName as never,
        });

        await flow.cns
            .stimulate(flow.input.createSignal({ id: 1 }))
            .waitUntilComplete();
        handle.detach();

        // A span that is never ended is never exported — the batch processor just
        // holds it.
        expect(spans.every(s => s.ended)).toBe(true);
    });

    it('closes an activation with the engine measurement, not wall time', async () => {
        const flow = buildFlow();
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(flow.cns as never, {
            tracer,
            neuronName: flow.neuronName as never,
            collateralName: flow.collateralName as never,
        });

        await flow.cns
            .stimulate(flow.input.createSignal({ id: 1 }))
            .waitUntilComplete();

        // `startedAt + duration` — the moment the activation actually settled,
        // which is not when the listener happens to run.
        const n1 = spans.find(s => s.name === 'n1')!;
        expect(typeof n1.endTime).toBe('number');
    });

    it('gives every subscriber of one collateral its own span', async () => {
        // Two neurons on the same collateral are two activations, not one.
        const input = collateral<{ id: number }>();
        const out = collateral<{ ok: boolean }>();
        const producer = neuron({ out }).dendrite({
            collateral: input,
            response: (_p, axon) => axon.out.createSignal({ ok: true }),
        });
        const a = neuron({}).dendrite({
            collateral: out,
            response: () => undefined,
        });
        const b = neuron({}).dendrite({
            collateral: out,
            response: () => undefined,
        });
        const names = new Map<object, string>([
            [producer as object, 'producer'],
            [a as object, 'a'],
            [b as object, 'b'],
        ]);

        const cns = new CNS([producer, a, b]);
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(cns as never, {
            tracer,
            neuronName: (n: object) => names.get(n),
        } as never);

        await cns.stimulate(input.createSignal({ id: 1 })).waitUntilComplete();

        expect(spans.filter(s => s.name === 'a')).toHaveLength(1);
        expect(spans.filter(s => s.name === 'b')).toHaveLength(1);
        expect(spans.find(s => s.name === 'a')!.parent).toBe('producer');
        expect(spans.find(s => s.name === 'b')!.parent).toBe('producer');
    });

    it('keeps an array fan-out under its producer, not under the root', async () => {
        // An activation returning an ARRAY answers once per signal. Closing its
        // span on the FIRST of those and forgetting it sent every later child to
        // the root instead of to the neuron that actually produced it.
        const input = collateral<{ id: number }>();
        const item = collateral<{ n: number }>();
        const fanOut = neuron({ item }).dendrite({
            collateral: input,
            response: (_p, axon) => [
                axon.item.createSignal({ n: 1 }),
                axon.item.createSignal({ n: 2 }),
            ],
        });
        const worker = neuron({}).dendrite({
            collateral: item,
            response: () => undefined,
        });
        const names = new Map<object, string>([
            [fanOut as object, 'fanOut'],
            [worker as object, 'worker'],
        ]);

        const cns = new CNS([fanOut, worker]);
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(cns as never, {
            tracer,
            neuronName: (n: object) => names.get(n),
        } as never);

        await cns.stimulate(input.createSignal({ id: 1 })).waitUntilComplete();

        const workers = spans.filter(s => s.name === 'worker');
        expect(workers).toHaveLength(2);
        expect(workers.map(w => w.parent)).toEqual(['fanOut', 'fanOut']);
    });

    it('marks a failed activation and its run as errors', async () => {
        const input = collateral<{ id: number }>();
        const boom = neuron({}).dendrite({
            collateral: input,
            response: () => {
                throw new Error('boom');
            },
        });
        const names = new Map<object, string>([[boom as object, 'boom']]);

        const cns = new CNS([boom]);
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(cns as never, {
            tracer,
            neuronName: (n: object) => names.get(n),
        } as never);

        await cns
            .stimulate(input.createSignal({ id: 1 }))
            .waitUntilComplete()
            .catch(() => undefined);

        expect(spans.find(s => s.name === 'boom')!.status).toBe(
            SpanStatusCode.ERROR
        );
    });

    it('keeps concurrent runs apart', async () => {
        const flow = buildFlow();
        const { tracer, spans } = fakeTracer();
        attachCNSOtelTracing(flow.cns as never, {
            tracer,
            neuronName: flow.neuronName as never,
            collateralName: flow.collateralName as never,
        });

        await Promise.all([
            flow.cns.stimulate(flow.input.createSignal({ id: 1 })).waitUntilComplete(),
            flow.cns.stimulate(flow.input.createSignal({ id: 2 })).waitUntilComplete(),
        ]);

        // Two runs, two complete trees — not one tree with doubled children.
        expect(spans.filter(s => s.name === 'input')).toHaveLength(2);
        expect(spans.filter(s => s.name === 'n1')).toHaveLength(2);
        expect(spans.filter(s => s.name === 'n1' && s.parent === 'input')).toHaveLength(2);
    });

    it('writes its span into the activation, before that activation runs', async () => {
        // This is what lets a call made INSIDE a neuron nest under its own span.
        // Read from the neuron, not from a local `onResponse`: the engine calls
        // the local listener BEFORE the global ones (CNS.ts), so a local listener
        // is too early to see what a global one stamps. The dendrite is not.
        const input = collateral<{ id: number }>();
        const seen: (TCNSOtelCompartment | undefined)[] = [];

        const worker = neuron({}).dendrite({
            collateral: input,
            response: (_p, _axon, ctx: any) => {
                seen.push(ctx.activationContext?.[CNS_OTEL_CONTEXT]);
            },
        });
        const names = new Map<object, string>([[worker as object, 'worker']]);

        const cns = new CNS([worker]);
        const { tracer } = fakeTracer();
        attachCNSOtelTracing(cns as never, {
            tracer,
            neuronName: (n: object) => names.get(n),
        } as never);

        await cns.stimulate(input.createSignal({ id: 1 })).waitUntilComplete();

        expect(seen).toHaveLength(1);
        expect(seen[0]?.context).toBeDefined();
        expect(seen[0]?.traceparent).toMatch(/^00-[0-9a-f]{32}-\S+-0[01]$/);
    });

    it('leaves the store alone when it is not the one writing', async () => {
        // Its compartment is keyed by package name, so a value someone else put
        // in the same store is still there afterwards.
        const input = collateral<{ id: number }>();
        let seen: Record<string, unknown> | undefined;

        const worker = neuron({}).dendrite({
            collateral: input,
            response: (_p, _axon, ctx: any) => {
                seen = ctx.activationContext;
            },
        });
        const names = new Map<object, string>([[worker as object, 'worker']]);

        const cns = new CNS([worker]);
        const { tracer } = fakeTracer();
        attachCNSOtelTracing(cns as never, {
            tracer,
            neuronName: (n: object) => names.get(n),
        } as never);

        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: (r: any) => {
                    for (const task of r.scheduledActivationTasks ?? [])
                        (task.activationContext ??= {})['mine'] = 'kept';
                },
            })
            .waitUntilComplete();

        expect(seen?.['mine']).toBe('kept');
        expect(seen?.[CNS_OTEL_CONTEXT]).toBeDefined();
    });

    describe('a Retry is the same run, so it is the same trace', () => {
        /** A flow whose second neuron fails until `fail.v` is cleared. */
        const failing = (fail: { v: boolean }) => {
            const input = collateral<{ id: number }>();
            const mid = collateral<{ id: number }>();
            const n1 = neuron({ mid }).dendrite({
                collateral: input,
                response: (p, axon) => axon.mid.createSignal({ id: p!.id }),
            });
            const n2 = neuron({}).dendrite({
                collateral: mid,
                response: () => {
                    if (fail.v) throw new Error('boom');
                },
            });
            const names = new Map<object, string>([
                [n1 as object, 'n1'],
                [n2 as object, 'n2'],
            ]);
            return {
                cns: new CNS([n1, n2]),
                input,
                mid,
                n2,
                neuronName: (n: object) => names.get(n),
            };
        };

        it('records a run it first sees mid-flight', async () => {
            // `activate` has no entry injection — the frontier goes straight into
            // the queue — so a resumed run used to produce no spans at all.
            const flow = failing({ v: false });
            const { tracer, spans } = fakeTracer();
            attachCNSOtelTracing(flow.cns as never, {
                tracer,
                neuronName: flow.neuronName as never,
            } as never);

            await flow.cns
                .activate(
                    [
                        {
                            neuron: flow.n2,
                            dendriteCollateral: flow.mid,
                            input: flow.mid.createSignal({ id: 1 }),
                        },
                    ] as never,
                    { stimulationContext: {} }
                )
                .waitUntilComplete();

            expect(spans.map(s => s.name)).toContain('n2');
        });

        it('rejoins the trace the previous attempt recorded', async () => {
            const flow = failing({ v: false });
            const { tracer, spans } = fakeTracer();
            attachCNSOtelTracing(flow.cns as never, {
                tracer,
                neuronName: flow.neuronName as never,
            } as never);

            // What a previous attempt left in the run store, restored by hydrate.
            const previous =
                '00-11111111111111111111111111111111-2222222222222222-01';
            await flow.cns
                .activate(
                    [
                        {
                            neuron: flow.n2,
                            dendriteCollateral: flow.mid,
                            input: flow.mid.createSignal({ id: 1 }),
                        },
                    ] as never,
                    {
                        stimulationContext: {
                            [CNS_OTEL_CONTEXT]: { traceparent: previous },
                        },
                    }
                )
                .waitUntilComplete();

            // Same stimulation, one attempt later: same trace, not a new one.
            for (const span of spans)
                expect(span.traceId).toBe('11111111111111111111111111111111');
        });

        it('starts its own trace when there is nothing to rejoin', async () => {
            const flow = failing({ v: false });
            const { tracer, spans } = fakeTracer();
            attachCNSOtelTracing(flow.cns as never, {
                tracer,
                neuronName: flow.neuronName as never,
            } as never);

            await flow.cns
                .activate(
                    [
                        {
                            neuron: flow.n2,
                            dendriteCollateral: flow.mid,
                            input: flow.mid.createSignal({ id: 1 }),
                        },
                    ] as never,
                    { stimulationContext: {} }
                )
                .waitUntilComplete();

            expect(spans.length).toBeGreaterThan(0);
            expect(spans[0].traceId).not.toBe(
                '11111111111111111111111111111111'
            );
        });

        it('leaves the run its trace identity for a later attempt to find', async () => {
            const flow = failing({ v: false });
            const { tracer } = fakeTracer();
            attachCNSOtelTracing(flow.cns as never, {
                tracer,
                neuronName: flow.neuronName as never,
            } as never);

            const store: Record<string, unknown> = {};
            await flow.cns
                .stimulate(flow.input.createSignal({ id: 1 }), {
                    stimulationContext: store,
                })
                .waitUntilComplete();

            // A Retry of this run reads this and rejoins.
            expect(
                (store[CNS_OTEL_CONTEXT] as { traceparent?: string })
                    ?.traceparent
            ).toMatch(/^00-[0-9a-f]{32}-\S+-0[01]$/);
        });
    });

    it('stops recording once detached', async () => {
        const flow = buildFlow();
        const { tracer, spans } = fakeTracer();
        const handle = attachCNSOtelTracing(flow.cns as never, {
            tracer,
            neuronName: flow.neuronName as never,
            collateralName: flow.collateralName as never,
        });
        handle.detach();

        await flow.cns
            .stimulate(flow.input.createSignal({ id: 1 }))
            .waitUntilComplete();

        expect(spans).toHaveLength(0);
    });
});
