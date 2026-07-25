import { atom, createStore } from 'jotai';
import { CNS, collateral, neuron } from '@cnstra/core';

/**
 * Verifies the "Batching state managers" recipe against real Jotai.
 *
 * Jotai has no pluggable scheduler, but `store.sub` is synchronous, so the
 * notification can be intercepted and re-broadcast once per CNStra turn.
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

describe('Jotai driven by onDrain', () => {
    it('collapses a whole synchronous turn into one notification', async () => {
        const countAtom = atom(0);
        const labelAtom = atom('');
        const viewAtom = atom(get => `${get(countAtom)}:${get(labelAtom)}`);
        const store = createStore();

        const start = collateral<number>();
        const second = collateral<number>();

        const n1 = neuron({ second }).dendrite({
            collateral: start,
            response: (_p, axon) => {
                store.set(countAtom, 1);
                return axon.second.createSignal(1);
            },
        });
        const n2 = neuron({}).dendrite({
            collateral: second,
            response: () => {
                store.set(labelAtom, 'done');
                return undefined;
            },
        });

        const cns = new CNS([n1, n2]);

        let rawNotifications = 0;
        const rawUnsub = store.sub(viewAtom, () => { rawNotifications++; });

        const gate = gateNotifications(cns, onChange =>
            store.sub(viewAtom, onChange)
        );
        const gated: string[] = [];
        gate.subscribe(() => gated.push(store.get(viewAtom)));

        await cns.stimulate(start.createSignal(0)).waitUntilComplete();
        rawUnsub();
        gate.dispose();

        // Two top-level sets, two separate Jotai transactions...
        expect(rawNotifications).toBe(2);
        // ...collapsed into one notification for the turn.
        expect(gated).toEqual(['1:done']);
    });

    it('still notifies once per turn across an await', async () => {
        const loadingAtom = atom(false);
        const dataAtom = atom<string | null>(null);
        const viewAtom = atom(
            get => `${get(loadingAtom)}/${get(dataAtom) ?? '-'}`
        );
        const store = createStore();

        const click = collateral<number>();
        const done = collateral<number>();

        const loader = neuron({ done }).dendrite({
            collateral: click,
            response: async (_p, axon) => {
                store.set(loadingAtom, true); // optimistic, before yielding
                await new Promise(r => setTimeout(r, 5));
                return axon.done.createSignal(1);
            },
        });
        const finish = neuron({}).dendrite({
            collateral: done,
            response: () => {
                store.set(loadingAtom, false);
                store.set(dataAtom, 'payload');
                return undefined;
            },
        });

        const cns = new CNS([loader, finish]);
        const gate = gateNotifications(cns, onChange =>
            store.sub(viewAtom, onChange)
        );
        const gated: string[] = [];
        gate.subscribe(() => gated.push(store.get(viewAtom)));

        await cns.stimulate(click.createSignal(0)).waitUntilComplete();
        gate.dispose();

        // One notification per synchronous turn, and the optimistic write is
        // observable at the first boundary rather than swallowed by the await.
        expect(gated).toEqual(['true/-', 'false/payload']);
    });

    it('confirms set() is transactional for nested writes', () => {
        const a = atom(0);
        const b = atom(0);
        const sum = atom(get => get(a) + get(b));
        const both = atom(null, (_get, set, [x, y]: [number, number]) => {
            set(a, x);
            set(b, y);
        });
        const store = createStore();

        let notifications = 0;
        const unsub = store.sub(sum, () => { notifications++; });

        store.set(a, 1);
        store.set(b, 1);
        expect(notifications).toBe(2); // two top-level sets, two transactions

        notifications = 0;
        store.set(both, [2, 2]);
        expect(notifications).toBe(1); // nested writes share one transaction

        unsub();
    });

    it('leaves read-your-writes inside a turn untouched', async () => {
        const nAtom = atom(0);
        const store = createStore();
        const readings: number[] = [];

        const a = collateral<number>();
        const b = collateral<number>();

        const writer = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => {
                store.set(nAtom, 42);
                return axon.b.createSignal(1);
            },
        });
        const reader = neuron({}).dendrite({
            collateral: b,
            response: () => {
                readings.push(store.get(nAtom));
                return undefined;
            },
        });

        const cns = new CNS([writer, reader]);
        const gate = gateNotifications(cns, onChange => store.sub(nAtom, onChange));

        await cns.stimulate(a.createSignal(0)).waitUntilComplete();
        gate.dispose();

        // Gating the notification must not gate the write.
        expect(readings).toEqual([42]);
    });
});
