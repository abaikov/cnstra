import { CNS, collateral, neuron } from '../src/index';

/**
 * Semantics under test:
 *   queueLength        - every activation still owned, in any state
 *   pendingActivations - body not invoked yet (queued, held, or reserved)
 *   activeActivations  - body invoked, awaiting an unsettled promise
 *
 * Invariant: queueLength === pendingActivations + activeActivations, and
 * queueLength === 0 exactly on the terminal response.
 */

type Trace = { q: number; p: number; a: number; out: unknown; err?: string };

const fmt = (t: Trace[]) => t.map(r => `${r.q}(${r.p}/${r.a})`).join(' ');

const record = (trace: Trace[]) => (r: any) => {
    trace.push({
        q: r.queueLength,
        p: r.pendingActivations,
        a: r.activeActivations,
        out: r.outputSignal?.payload,
        err: r.error?.message,
    });
};

const expectInvariant = (trace: Trace[]) => {
    for (const r of trace) expect(r.q).toBe(r.p + r.a);
};

describe('response counters', () => {
    it('holds the invariant and reports zero exactly once, on the last response', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const n1 = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => axon.b.createSignal(1),
        });
        const n2 = neuron({}).dendrite({
            collateral: b,
            response: () => undefined,
        });

        const trace: Trace[] = [];
        const cns = new CNS([n1, n2]);
        await cns
            .stimulate(a.createSignal(1), { onResponse: record(trace) })
            .waitUntilComplete();

        expectInvariant(trace);
        const zeros = trace.filter(r => r.q === 0);
        expect(zeros).toHaveLength(1);
        expect(trace[trace.length - 1]).toBe(zeros[0]);
    });

    it('splits an in-flight async body into activeActivations', async () => {
        const start = collateral<string>();
        const late = collateral<string>();
        const slow = neuron({ late }).dendrite({
            collateral: start,
            response: async (_p, axon) => {
                await new Promise(r => setTimeout(r, 5));
                return axon.late.createSignal('L');
            },
        });
        const fast = neuron({}).dendrite({
            collateral: start,
            response: () => undefined,
        });
        const afterLate = neuron({}).dendrite({
            collateral: late,
            response: () => undefined,
        });

        const trace: Trace[] = [];
        const cns = new CNS([slow, fast, afterLate]);
        await cns
            .stimulate(start.createSignal('s'), { onResponse: record(trace) })
            .waitUntilComplete();

        expectInvariant(trace);
        // initial fan-out reserves 2 -> fast's leaf sees only slow in flight ->
        // slow resolves and schedules afterLate -> afterLate's leaf completes.
        expect(fmt(trace)).toBe('2(2/0) 1(0/1) 1(1/0) 0(0/0)');
    });

    it('does not report zero while sibling signals are undispatched', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        // `a` has no subscriber at all: before the fix this reported zero here,
        // before `b` had even been looked at.
        const onlyB = neuron({}).dendrite({
            collateral: b,
            response: () => undefined,
        });

        const trace: Trace[] = [];
        const cns = new CNS([onlyB]);
        await cns
            .stimulate([a.createSignal(1), b.createSignal(2)], {
                onResponse: record(trace),
            })
            .waitUntilComplete();

        expectInvariant(trace);
        expect(trace.filter(r => r.q === 0)).toHaveLength(1);
        expect(trace[trace.length - 1].q).toBe(0);
    });

    it('does not report zero while a sibling subtree is still to come', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const c = collateral<number>();
        const leafA = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const bToC = neuron({ c }).dendrite({
            collateral: b,
            response: (_p, axon) => axon.c.createSignal(3),
        });
        const leafC = neuron({}).dendrite({
            collateral: c,
            response: () => undefined,
        });

        const seen: number[] = [];
        const trace: Trace[] = [];
        const cns = new CNS([leafA, bToC, leafC]);
        await cns
            .stimulate([a.createSignal(1), b.createSignal(2)], {
                onResponse: r => {
                    if (r.inputSignal)
                        seen.push(r.inputSignal.payload as number);
                    record(trace)(r);
                },
            })
            .waitUntilComplete();

        expectInvariant(trace);
        // `a`'s subtree drains fully before `b` is dispatched, so the reservation
        // is what keeps `a`'s leaf from reading as the end of the stimulation.
        expect(seen).toEqual([1, 2, 3]);
        expect(trace.filter(r => r.q === 0)).toHaveLength(1);
        expect(trace[trace.length - 1].q).toBe(0);
    });

    it('does not complete before every signal of an array has been dispatched', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const seen: number[] = [];
        const mk = (c: any) =>
            neuron({}).dendrite({
                collateral: c,
                response: (p: any) => {
                    seen.push(p as number);
                    return undefined;
                },
            });
        const cns = new CNS([mk(a), mk(b)]);
        await cns
            .stimulate([a.createSignal(1), b.createSignal(2)])
            .waitUntilComplete();
        expect(seen).toEqual([1, 2]);
    });

    it('counts subscribers parked behind an async onResponse as pending, not active', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const n1 = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => axon.b.createSignal(1),
        });
        const n2 = neuron({}).dendrite({
            collateral: b,
            response: () => undefined,
        });

        const trace: Trace[] = [];
        const cns = new CNS([n1, n2]);
        await cns
            .stimulate(a.createSignal(1), {
                onResponse: async r => {
                    record(trace)(r);
                    await Promise.resolve();
                },
            })
            .waitUntilComplete();

        expectInvariant(trace);
        // Their body never ran, so nothing is ever counted as active.
        expect(trace.every(r => r.a === 0)).toBe(true);
        expect(trace.filter(r => r.q === 0)).toHaveLength(1);
        expect(trace[trace.length - 1].q).toBe(0);
    });

    it('emits a terminal response when the tail task has no subscriber', async () => {
        const a = collateral<number>();
        const orphan = collateral<number>();
        const n1 = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const cns = new CNS([n1]);

        const trace: Trace[] = [];
        const stim = cns.activate(
            [{ neuron: n1 as any, dendriteCollateral: orphan as any }],
            { onResponse: record(trace) }
        );
        await stim.waitUntilComplete().catch(() => {});

        expect(trace).toHaveLength(1);
        expect(trace[0].q).toBe(0);
        expect(trace[0].err).toMatch(/Subscriber not found/);
        expect(stim.getFailedTasks()).toHaveLength(1);
    });

    it('does not inflate activeActivations on a synchronously thrown error', async () => {
        const a = collateral<number>();
        const boom = neuron({}).dendrite({
            collateral: a,
            response: () => {
                throw new Error('boom');
            },
        });
        const trace: Trace[] = [];
        const cns = new CNS([boom]);
        await cns
            .stimulate(a.createSignal(1), { onResponse: record(trace) })
            .waitUntilComplete()
            .catch(() => {});

        const err = trace.find(r => r.err === 'boom')!;
        expect(err).toBeDefined();
        expect(err.a).toBe(0);
        expect(err.q).toBe(0);
    });
});
