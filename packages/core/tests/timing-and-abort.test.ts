import { CNS, collateral, neuron } from '../src';
import type { TCNSStimulationResponse } from '@cnstra/types';

const collect = () => {
    const responses: TCNSStimulationResponse[] = [];
    return { responses, onResponse: (r: TCNSStimulationResponse) => void responses.push(r) };
};

/** Responses that correspond to a real neuron activation. */
const activations = (responses: TCNSStimulationResponse[]) =>
    responses.filter(r => r.neuron);

describe('per-activation timing', () => {
    it('reports startedAt and duration for a synchronous body', async () => {
        const input = collateral<{ id: number }>();
        const out = collateral<{ id: number }>();
        const n = neuron({ out }).dendrite({
            collateral: input,
            response: (p, axon) => axon.out.createSignal({ id: p!.id }),
        });

        const cns = new CNS([n]);
        const sink = collect();
        const before = Date.now();
        await cns
            .stimulate(input.createSignal({ id: 1 }), { onResponse: sink.onResponse })
            .waitUntilComplete();

        const [hop] = activations(sink.responses);
        expect(hop.startedAt).toBeGreaterThanOrEqual(before);
        expect(typeof hop.duration).toBe('number');
        expect(hop.duration).toBeGreaterThanOrEqual(0);
    });

    it('measures an async body for at least as long as it actually took', async () => {
        const input = collateral<{ id: number }>();
        const out = collateral<{ id: number }>();
        const n = neuron({ out }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                await new Promise(r => setTimeout(r, 30));
                return axon.out.createSignal({ id: p!.id });
            },
        });

        const cns = new CNS([n]);
        const sink = collect();
        await cns
            .stimulate(input.createSignal({ id: 1 }), { onResponse: sink.onResponse })
            .waitUntilComplete();

        const [hop] = activations(sink.responses);
        // The whole point of the field: a slow hop is visibly slow.
        expect(hop.duration).toBeGreaterThanOrEqual(25);
    });

    it('reports timing on the throw path too, where latency matters most', async () => {
        const input = collateral<{ id: number }>();
        const out = collateral<{ id: number }>();
        const n = neuron({ out }).dendrite({
            collateral: input,
            response: () => {
                throw new Error('boom');
            },
        });

        const cns = new CNS([n]);
        const sink = collect();
        await cns
            .stimulate(input.createSignal({ id: 1 }), { onResponse: sink.onResponse })
            .waitUntilComplete()
            .catch(() => {});

        const [hop] = activations(sink.responses);
        expect(hop.error).toBeDefined();
        expect(typeof hop.startedAt).toBe('number');
        expect(typeof hop.duration).toBe('number');
    });

    it('reports ONE duration per activation, not one per emitted signal', async () => {
        // An async body returning an array emits a response per signal, and each
        // one used to be measured when it was emitted — so a later signal was
        // charged for the synchronous subtree an earlier one had already drained.
        // One activation, one measurement.
        const input = collateral<{ id: number }>();
        const a = collateral<{ id: number }>();
        const b = collateral<{ id: number }>();
        const slowDone = collateral<{ id: number }>();
        const otherDone = collateral<{ id: number }>();

        const fanOut = neuron({ a, b }).dendrite({
            collateral: input,
            response: async (p, axon) => [
                axon.a.createSignal({ id: p!.id }),
                axon.b.createSignal({ id: p!.id }),
            ],
        });
        // Burns real synchronous time inside the first branch's subtree.
        const slowBranch = neuron({ slowDone }).dendrite({
            collateral: a,
            response: (p, axon) => {
                const until = Date.now() + 40;
                while (Date.now() < until) {
                    /* busy */
                }
                return axon.slowDone.createSignal({ id: p!.id });
            },
        });
        const otherBranch = neuron({ otherDone }).dendrite({
            collateral: b,
            response: (p, axon) => axon.otherDone.createSignal({ id: p!.id }),
        });
        const end = neuron({})
            .dendrite({ collateral: slowDone, response: () => undefined })
            .dendrite({ collateral: otherDone, response: () => undefined });

        const cns = new CNS([fanOut, slowBranch, otherBranch, end]);
        const collected = collect();
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: collected.onResponse,
            })
            .waitUntilComplete();

        const durations = collected.responses
            .filter(r => r.neuron === (fanOut as never))
            .map(r => r.duration);

        expect(durations.length).toBeGreaterThan(1);
        // Both responses describe the SAME activation, so they must agree.
        expect(new Set(durations).size).toBe(1);
        // And it must not have absorbed the 40ms its own child spent.
        expect(durations[0]).toBeLessThan(35);
    });

    it('leaves timing undefined on responses that are not an activation', async () => {
        const input = collateral<{ id: number }>();
        const out = collateral<{ id: number }>();
        const n = neuron({ out }).dendrite({
            collateral: input,
            response: (p, axon) => axon.out.createSignal({ id: p!.id }),
        });

        const cns = new CNS([n]);
        const sink = collect();
        await cns
            .stimulate(input.createSignal({ id: 1 }), { onResponse: sink.onResponse })
            .waitUntilComplete();

        for (const r of sink.responses.filter(r => !r.neuron)) {
            expect(r.startedAt).toBeUndefined();
            expect(r.duration).toBeUndefined();
        }
    });
});

describe('abort announces the ending', () => {
    it('announces the ending EXACTLY once, never twice', async () => {
        // Here the abort lands while a response runs, but the response completes and
        // drains the queue — so a real activation already reported
        // `queueLength === 0`. A second, synthetic one would double-count the
        // hop, race two terminal flushes, and open a second root span per run.
        const input = collateral<{ id: number }>();
        const out = collateral<{ id: number }>();
        const controller = new AbortController();

        const n = neuron({ out }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                controller.abort();
                await new Promise(r => setTimeout(r, 10));
                return axon.out.createSignal({ id: p!.id });
            },
        });

        const cns = new CNS([n]);
        const sink = collect();

        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: sink.onResponse,
                abortSignal: controller.signal,
            })
            .waitUntilComplete()
            .catch(() => {});

        expect(
            sink.responses.filter(r => r.queueLength === 0)
        ).toHaveLength(1);
    });

    it('still announces the ending when queued work never got to run', async () => {
        // The case the synthetic response exists for: the abort cuts off tasks
        // sitting in the queue, so no activation ever settles the queue to zero.
        const input = collateral<{ id: number }>();
        const mid = collateral<{ id: number }>();
        const out = collateral<{ id: number }>();
        const controller = new AbortController();

        const slow = neuron({ mid }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                await new Promise(r => setTimeout(r, 30));
                return axon.mid.createSignal({ id: p!.id });
            },
        });
        const next = neuron({ out }).dendrite({
            collateral: mid,
            response: (p, axon) => axon.out.createSignal({ id: p!.id }),
        });

        const cns = new CNS([slow, next]);
        const sink = collect();

        const stimulation = cns.stimulate(input.createSignal({ id: 1 }), {
            onResponse: sink.onResponse,
            abortSignal: controller.signal,
        });
        await new Promise(r => setTimeout(r, 5));
        controller.abort();
        await stimulation.waitUntilComplete().catch(() => {});

        const terminal = sink.responses.filter(r => r.queueLength === 0);
        expect(terminal).toHaveLength(1);
        // This one is the synthetic signal, and it reports the abort.
        expect(terminal[0].error).toBeDefined();
        expect(terminal[0].neuron).toBeUndefined();
    });
});
