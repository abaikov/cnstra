import { createStore as createZustandStore } from 'zustand/vanilla';
import { proxy, subscribe as valtioSubscribe, snapshot } from 'valtio/vanilla';
import { legacy_createStore } from 'redux';
import { CNS, collateral, neuron } from '@cnstra/core';

/**
 * Verifies the notification-interception pattern from the "Batching state
 * managers" recipe against Zustand, Valtio and Redux.
 *
 * None of them has a pluggable scheduler, but all three notify synchronously, so
 * the notification can be intercepted and re-broadcast once per CNStra turn.
 * Writes stay immediate, so read-your-writes is unaffected.
 */

/** Collapse a store's synchronous notifications into one per drain. */
const gateNotifications = (
    cns: CNS<any, any>,
    subscribe: (onChange: () => void) => () => void
) => {
    const listeners = new Set<() => void>();
    let dirty = false;

    const unsub = subscribe(() => { dirty = true; });
    const offDrain = cns.addDrainListener(() => {
        if (!dirty) return;
        dirty = false;
        for (const l of listeners) l();
    });

    return {
        subscribe: (l: () => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        dispose: () => { unsub(); offDrain(); },
    };
};

/**
 * A three-neuron chain plus an async branch, shared by every store below.
 * `write` is invoked once per neuron; `read` runs in the last synchronous
 * neuron and must observe everything written before it in the same turn.
 */
const buildGraph = (
    write: (step: string) => void,
    read: () => void
) => {
    const start = collateral<number>();
    const second = collateral<number>();
    const third = collateral<number>();

    const n1 = neuron({ second }).dendrite({
        collateral: start,
        response: (_p, axon) => { write('a'); return axon.second.createSignal(1); },
    });
    const n2 = neuron({ third }).dendrite({
        collateral: second,
        response: (_p, axon) => { write('b'); return axon.third.createSignal(1); },
    });
    const n3 = neuron({}).dendrite({
        collateral: third,
        response: () => { write('c'); read(); return undefined; },
    });

    return { start, neurons: [n1, n2, n3] };
};

describe('Zustand gated by onDrain', () => {
    it('collapses a turn into one notification and keeps read-your-writes', async () => {
        const store = createZustandStore<{ steps: string[] }>(() => ({
            steps: [],
        }));

        let readInsideTurn: string[] = [];
        const { start, neurons } = buildGraph(
            step => store.setState(s => ({ steps: [...s.steps, step] })),
            () => { readInsideTurn = store.getState().steps; }
        );
        const cns = new CNS(neurons);

        let raw = 0;
        const rawOff = store.subscribe(() => { raw++; });
        const gate = gateNotifications(cns, cb => store.subscribe(cb));
        const gated: string[][] = [];
        gate.subscribe(() => gated.push(store.getState().steps));

        await cns.stimulate(start.createSignal(0)).waitUntilComplete();
        rawOff();
        gate.dispose();

        expect(raw).toBe(3);                            // one per setState
        expect(gated).toEqual([['a', 'b', 'c']]);       // one for the turn
        expect(readInsideTurn).toEqual(['a', 'b', 'c']); // writes were not deferred
    });

    it('surfaces an optimistic write made before an await', async () => {
        const store = createZustandStore<{ loading: boolean; data: string | null }>(
            () => ({ loading: false, data: null })
        );

        const click = collateral<number>();
        const done = collateral<number>();

        const loader = neuron({ done }).dendrite({
            collateral: click,
            response: async (_p, axon) => {
                store.setState({ loading: true }); // before yielding
                await new Promise(r => setTimeout(r, 5));
                return axon.done.createSignal(1);
            },
        });
        const finish = neuron({}).dendrite({
            collateral: done,
            response: () => {
                store.setState({ loading: false, data: 'payload' });
                return undefined;
            },
        });

        const cns = new CNS([loader, finish]);
        const gate = gateNotifications(cns, cb => store.subscribe(cb));
        const seen: string[] = [];
        gate.subscribe(() => {
            const s = store.getState();
            seen.push(`${s.loading}/${s.data ?? '-'}`);
        });

        await cns.stimulate(click.createSignal(0)).waitUntilComplete();
        gate.dispose();

        expect(seen).toEqual(['true/-', 'false/payload']);
    });
});

describe('Valtio gated by onDrain', () => {
    it('collapses a turn into one notification and keeps read-your-writes', async () => {
        const state = proxy<{ steps: string[] }>({ steps: [] });

        let readInsideTurn: string[] = [];
        const { start, neurons } = buildGraph(
            step => { state.steps.push(step); },
            () => { readInsideTurn = [...state.steps]; }
        );
        const cns = new CNS(neurons);

        // notifyInSync: true - otherwise valtio does its own microtask batching
        // and we would be layering one scheduler on another.
        const gate = gateNotifications(cns, cb =>
            valtioSubscribe(state, cb, true)
        );
        const gated: string[][] = [];
        gate.subscribe(() => gated.push([...snapshot(state).steps]));

        await cns.stimulate(start.createSignal(0)).waitUntilComplete();
        gate.dispose();

        expect(gated).toEqual([['a', 'b', 'c']]);
        expect(readInsideTurn).toEqual(['a', 'b', 'c']);
    });

    it('surfaces an optimistic write made before an await', async () => {
        const state = proxy<{ loading: boolean; data: string | null }>({
            loading: false,
            data: null,
        });

        const click = collateral<number>();
        const done = collateral<number>();

        const loader = neuron({ done }).dendrite({
            collateral: click,
            response: async (_p, axon) => {
                state.loading = true; // before yielding
                await new Promise(r => setTimeout(r, 5));
                return axon.done.createSignal(1);
            },
        });
        const finish = neuron({}).dendrite({
            collateral: done,
            response: () => {
                state.loading = false;
                state.data = 'payload';
                return undefined;
            },
        });

        const cns = new CNS([loader, finish]);
        const gate = gateNotifications(cns, cb =>
            valtioSubscribe(state, cb, true)
        );
        const seen: string[] = [];
        gate.subscribe(() => {
            const s = snapshot(state);
            seen.push(`${s.loading}/${s.data ?? '-'}`);
        });

        await cns.stimulate(click.createSignal(0)).waitUntilComplete();
        gate.dispose();

        // Two boundaries, not one: proof the flush follows each turn rather than
        // only the end of the run.
        expect(seen).toEqual(['true/-', 'false/payload']);
    });

    it('notifies synchronously only when notifyInSync is set', async () => {
        const state = proxy<{ n: number }>({ n: 0 });

        let syncCalls = 0;
        let asyncCalls = 0;
        const offSync = valtioSubscribe(state, () => { syncCalls++; }, true);
        const offAsync = valtioSubscribe(state, () => { asyncCalls++; });

        state.n = 1;
        state.n = 2;

        // Synchronous subscriber has already seen both writes...
        expect(syncCalls).toBe(2);
        // ...while the default subscriber has not fired at all yet.
        expect(asyncCalls).toBe(0);

        await new Promise(r => setTimeout(r, 0));
        expect(asyncCalls).toBeGreaterThan(0);

        offSync();
        offAsync();
    });
});

describe('Redux gated by onDrain', () => {
    type State = { steps: string[] };
    const reducer = (
        state: State = { steps: [] },
        action: { type: string; step?: string }
    ): State =>
        action.type === 'push'
            ? { steps: [...state.steps, action.step!] }
            : state;

    it('collapses a turn into one notification and keeps read-your-writes', async () => {
        const store = legacy_createStore(reducer);

        let readInsideTurn: string[] = [];
        const { start, neurons } = buildGraph(
            step => store.dispatch({ type: 'push', step }),
            () => { readInsideTurn = store.getState().steps; }
        );
        const cns = new CNS(neurons);

        let raw = 0;
        const rawOff = store.subscribe(() => { raw++; });
        const gate = gateNotifications(cns, cb => store.subscribe(cb));
        const gated: string[][] = [];
        gate.subscribe(() => gated.push(store.getState().steps));

        await cns.stimulate(start.createSignal(0)).waitUntilComplete();
        rawOff();
        gate.dispose();

        expect(raw).toBe(3);                             // one per dispatch
        expect(gated).toEqual([['a', 'b', 'c']]);        // one for the turn
        expect(readInsideTurn).toEqual(['a', 'b', 'c']); // dispatch was not deferred
    });

    it('surfaces an optimistic write made before an await', async () => {
        const store = legacy_createStore(reducer);

        const click = collateral<number>();
        const done = collateral<number>();

        const loader = neuron({ done }).dendrite({
            collateral: click,
            response: async (_p, axon) => {
                store.dispatch({ type: 'push', step: 'optimistic' });
                await new Promise(r => setTimeout(r, 5));
                return axon.done.createSignal(1);
            },
        });
        const finish = neuron({}).dendrite({
            collateral: done,
            response: () => {
                store.dispatch({ type: 'push', step: 'settled' });
                return undefined;
            },
        });

        const cns = new CNS([loader, finish]);
        const gate = gateNotifications(cns, cb => store.subscribe(cb));
        const seen: string[][] = [];
        gate.subscribe(() => seen.push(store.getState().steps));

        await cns.stimulate(click.createSignal(0)).waitUntilComplete();
        gate.dispose();

        // Two boundaries, not one: proof the flush follows each turn rather than
        // only the end of the run.
        expect(seen).toEqual([['optimistic'], ['optimistic', 'settled']]);
    });
});
