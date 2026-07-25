import { CNS, collateral, neuron } from '../src/index';

/**
 * onDrain marks the end of a synchronous turn. A turn can end in six ways and a
 * response is only emitted in the first of them, which is why the drain cannot be
 * derived from onResponse:
 *
 *   A. an activation finished and left the queue empty
 *   B. the last activation started and returned a promise
 *   C. the stimulation-level concurrency limit was reached
 *   D. the stimulation was aborted
 *   E. subscribers are parked behind an async onResponse
 *   F. a per-neuron setConcurrency gate forced an activation onto a promise
 */

type Drain = { q: number; p: number; a: number };

const fmt = (d: Drain[]) => d.map(x => `${x.q}(${x.p}/${x.a})`).join(' ');

const record = (out: Drain[]) => (d: any) => {
    out.push({
        q: d.queueLength,
        p: d.pendingActivations,
        a: d.activeActivations,
    });
};

const expectInvariant = (drains: Drain[]) => {
    expect(drains.length).toBeGreaterThan(0);
    for (const d of drains) expect(d.q).toBe(d.p + d.a);
};

describe('onDrain', () => {
    it('A: fires when an activation finishes and empties the queue', async () => {
        const a = collateral<number>();
        const leaf = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const drains: Drain[] = [];
        const cns = new CNS([leaf]);
        await cns
            .stimulate(a.createSignal(1), { onDrain: record(drains) })
            .waitUntilComplete();

        // A purely synchronous stimulation is a single turn.
        expect(fmt(drains)).toBe('0(0/0)');
    });

    it('B: fires when the last activation starts and goes async', async () => {
        const start = collateral<number>();
        const mid = collateral<number>();
        const writes: string[] = [];
        const drains: Drain[] = [];
        const flushed: string[][] = [];

        const n1 = neuron({ mid }).dendrite({
            collateral: start,
            response: async (_p, axon) => {
                writes.push('optimistic'); // synchronous write before yielding
                await new Promise(r => setTimeout(r, 5));
                return axon.mid.createSignal(1);
            },
        });
        const n2 = neuron({}).dendrite({
            collateral: mid,
            response: () => {
                writes.push('loaded');
                return undefined;
            },
        });

        const cns = new CNS([n1, n2]);
        const stim = cns.stimulate(start.createSignal(1), {
            onDrain: d => {
                record(drains)(d);
                flushed.push([...writes]);
            },
        });
        await stim.waitUntilComplete();

        expectInvariant(drains);
        // Two turns: the dispatch that parks on the promise, then the resume.
        expect(fmt(drains)).toBe('1(0/1) 0(0/0)');
        // The whole point: the write made before `await` is visible at a boundary
        // rather than waiting for the promise to settle.
        expect(flushed[0]).toEqual(['optimistic']);
        expect(flushed[1]).toEqual(['optimistic', 'loaded']);
    });

    it('B: the first drain happens before stimulate() returns', () => {
        const start = collateral<number>();
        const drains: Drain[] = [];
        const n1 = neuron({}).dendrite({
            collateral: start,
            response: async () => {
                await new Promise(r => setTimeout(r, 5));
                return undefined;
            },
        });
        const cns = new CNS([n1]);
        cns.stimulate(start.createSignal(1), { onDrain: record(drains) });
        // Synchronous assertion, no await: the boundary is in the same tick.
        expect(fmt(drains)).toBe('1(0/1)');
    });

    it('C: fires when the stimulation concurrency limit blocks the queue', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const fan = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => [
                axon.b.createSignal(1),
                axon.b.createSignal(2),
                axon.b.createSignal(3),
            ],
        });
        const slow = neuron({}).dendrite({
            collateral: b,
            response: async () => {
                await new Promise(r => setTimeout(r, 5));
                return undefined;
            },
        });
        const drains: Drain[] = [];
        const cns = new CNS([fan, slow]);
        await cns
            .stimulate(a.createSignal(0), {
                concurrency: 2,
                onDrain: record(drains),
            })
            .waitUntilComplete();

        expectInvariant(drains);
        // First boundary: two bodies running, the third blocked by the limit.
        expect(drains[0]).toEqual({ q: 3, p: 1, a: 2 });
        expect(drains[drains.length - 1]).toEqual({ q: 0, p: 0, a: 0 });
    });

    it('D: fires on abort, with the blocked remainder still counted', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const controller = new AbortController();
        const fan = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => [
                axon.b.createSignal(1),
                axon.b.createSignal(2),
            ],
        });
        const slow = neuron({}).dendrite({
            collateral: b,
            response: async () => {
                controller.abort();
                await new Promise(r => setTimeout(r, 5));
                return undefined;
            },
        });
        const drains: Drain[] = [];
        const cns = new CNS([fan, slow]);
        const stim = cns.stimulate(a.createSignal(0), {
            concurrency: 1,
            abortSignal: controller.signal,
            onDrain: record(drains),
        });
        await stim.waitUntilComplete().catch(() => {});

        expectInvariant(drains);
        // Aborted with work still queued: pending stays non-zero and nothing
        // will ever run it, which is why abort needs waitUntilComplete().catch().
        const last = drains[drains.length - 1];
        expect(last.p).toBeGreaterThan(0);
        expect(last.a).toBe(0);
    });

    it('E: fires when subscribers are parked behind an async onResponse', async () => {
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
        const drains: Drain[] = [];
        const cns = new CNS([n1, n2]);
        await cns
            .stimulate(a.createSignal(1), {
                onResponse: async () => {
                    await new Promise(r => setTimeout(r, 1));
                },
                onDrain: record(drains),
            })
            .waitUntilComplete();

        expectInvariant(drains);
        expect(drains.length).toBeGreaterThan(1);
        // Parked activations are pending, never active - their body never ran.
        expect(drains.every(d => d.a === 0)).toBe(true);
        expect(drains[drains.length - 1]).toEqual({ q: 0, p: 0, a: 0 });
    });

    it('F: fires when a per-neuron concurrency gate defers an activation', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const fan = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => [
                axon.b.createSignal(1),
                axon.b.createSignal(2),
            ],
        });
        // Synchronous body, but gated at 1: the second activation is forced onto
        // a promise, so the turn ends without that activation having finished.
        const gated = neuron({})
            .setConcurrency(1)
            .dendrite({ collateral: b, response: () => undefined });

        const drains: Drain[] = [];
        const cns = new CNS([fan, gated]);
        await cns
            .stimulate(a.createSignal(0), { onDrain: record(drains) })
            .waitUntilComplete();

        expectInvariant(drains);
        expect(drains[drains.length - 1]).toEqual({ q: 0, p: 0, a: 0 });
    });

    it('fires exactly once per turn even when a turn nests enqueues', async () => {
        const a = collateral<number>();
        const b = collateral<number>();
        const c = collateral<number>();
        const n1 = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => axon.b.createSignal(1),
        });
        const n2 = neuron({ c }).dendrite({
            collateral: b,
            response: (_p, axon) => axon.c.createSignal(1),
        });
        const n3 = neuron({}).dendrite({
            collateral: c,
            response: () => undefined,
        });
        const drains: Drain[] = [];
        const cns = new CNS([n1, n2, n3]);
        await cns
            .stimulate(a.createSignal(1), { onDrain: record(drains) })
            .waitUntilComplete();

        // Three neurons, one synchronous turn, one boundary.
        expect(fmt(drains)).toBe('0(0/0)');
    });

    it('survives a re-entrant stimulate() from inside the callback', async () => {
        const a = collateral<number>();
        const other = collateral<number>();
        const leaf = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const otherLeaf = neuron({}).dendrite({
            collateral: other,
            response: () => undefined,
        });
        const cns = new CNS([leaf, otherLeaf]);

        const perStimulation = new Map<object, number>();
        let fired = 0;
        cns.addDrainListener(d => {
            fired++;
            perStimulation.set(
                d.stimulation,
                (perStimulation.get(d.stimulation) ?? 0) + 1
            );
            // Re-entrant stimulate from inside a drain callback.
            if (fired < 3) cns.stimulate(other.createSignal(1));
        });

        const outer = cns.stimulate(a.createSignal(1));
        await outer.waitUntilComplete();

        // A nested stimulate() is a separate stimulation and announces its own
        // boundary inline, so the listener does nest - that is expected. What must
        // hold is that no single stimulation announces the same turn twice.
        expect(fired).toBe(3);
        expect(perStimulation.size).toBe(3);
        for (const count of perStimulation.values()) expect(count).toBe(1);
        expect(perStimulation.get(outer)).toBe(1);
    });

    it('is skipped entirely when nobody subscribes', async () => {
        const a = collateral<number>();
        const leaf = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const cns = new CNS([leaf]);
        await expect(
            cns.stimulate(a.createSignal(1)).waitUntilComplete()
        ).resolves.toBeUndefined();
    });

    it('delivers to a global listener registered on the CNS', async () => {
        const a = collateral<number>();
        const leaf = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const drains: Drain[] = [];
        const cns = new CNS([leaf]);
        const off = cns.addDrainListener(record(drains));

        await cns.stimulate(a.createSignal(1)).waitUntilComplete();
        expect(drains).toHaveLength(1);

        off();
        await cns.stimulate(a.createSignal(1)).waitUntilComplete();
        expect(drains).toHaveLength(1);
    });

    it('isolates a throwing listener from the stimulation', async () => {
        const a = collateral<number>();
        const leaf = neuron({}).dendrite({
            collateral: a,
            response: () => undefined,
        });
        const spy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const cns = new CNS([leaf]);
        const drains: Drain[] = [];
        cns.addDrainListener(() => {
            throw new Error('bad flush');
        });
        cns.addDrainListener(record(drains));

        await expect(
            cns.stimulate(a.createSignal(1)).waitUntilComplete()
        ).resolves.toBeUndefined();
        // The second listener still ran.
        expect(drains).toHaveLength(1);
        spy.mockRestore();
    });
});
