import { configure, observable, autorun, runInAction } from 'mobx';
import { CNS, collateral, neuron } from '@cnstra/core';

/**
 * Verifies the "Batching state managers" recipe against real MobX.
 *
 * MobX exposes `configure({ reactionScheduler })`, which hands us the function
 * that drains its pending reactions instead of running it immediately. Holding
 * that function until onDrain makes a CNStra turn the batching unit.
 *
 * Two MobX behaviours this file pins down, both of which the recipe must warn
 * about:
 *
 *  1. `configure({ reactionScheduler })` COMPOSES rather than replaces - MobX's
 *     setReactionScheduler wraps the previous scheduler. Calling it twice stacks
 *     them, and reactions end up captured by a scheduler nobody drains. Install
 *     it exactly once, at startup.
 *  2. With a scheduler installed, even a reaction's initial eager run is
 *     deferred. Reactions created outside a CNStra turn do not run until the
 *     next drain.
 */

// Installed exactly once for the whole module, the way an app would do it at
// startup. Per-test wiring only swaps the drain listener.
let flushReactions: (() => void) | null = null;
configure({ reactionScheduler: run => { flushReactions = run; } });

const wireToDrain = (cns: CNS<any, any>) =>
    cns.addDrainListener(() => {
        const run = flushReactions;
        flushReactions = null;
        run?.();
    });

describe('MobX driven by onDrain', () => {
    it('collapses a whole synchronous turn into one reaction run', async () => {
        const store = observable({ a: 0, b: 0, c: 0 });

        const start = collateral<number>();
        const second = collateral<number>();
        const third = collateral<number>();

        const n1 = neuron({ second }).dendrite({
            collateral: start,
            response: (_p, axon) => {
                runInAction(() => { store.a = 1; });
                return axon.second.createSignal(1);
            },
        });
        const n2 = neuron({ third }).dendrite({
            collateral: second,
            response: (_p, axon) => {
                runInAction(() => { store.b = 1; });
                return axon.third.createSignal(1);
            },
        });
        const n3 = neuron({}).dendrite({
            collateral: third,
            response: () => {
                runInAction(() => { store.c = 1; });
                return undefined;
            },
        });

        const cns = new CNS([n1, n2, n3]);
        const off = wireToDrain(cns);

        const seen: string[] = [];
        const disposeAutorun = autorun(() => {
            seen.push(`${store.a}${store.b}${store.c}`);
        });

        // Caveat 2: the eager first run is deferred too, so nothing has run yet.
        expect(seen).toEqual([]);

        await cns.stimulate(start.createSignal(0)).waitUntilComplete();
        disposeAutorun();
        off();

        // Three neurons, three writes, ONE reaction run for the whole turn.
        expect(seen).toEqual(['111']);
    });

    it('produces one reaction run per synchronous turn across an await', async () => {
        const store = observable({ loading: false, loaded: false });

        const click = collateral<number>();
        const done = collateral<number>();

        const loader = neuron({ done }).dendrite({
            collateral: click,
            response: async (_p, axon) => {
                // Optimistic write BEFORE yielding - the case a
                // queueLength-driven flush would miss entirely.
                runInAction(() => { store.loading = true; });
                await new Promise(r => setTimeout(r, 5));
                return axon.done.createSignal(1);
            },
        });
        const finish = neuron({}).dendrite({
            collateral: done,
            response: () => {
                runInAction(() => {
                    store.loading = false;
                    store.loaded = true;
                });
                return undefined;
            },
        });

        const cns = new CNS([loader, finish]);
        const off = wireToDrain(cns);

        const seen: string[] = [];
        const disposeAutorun = autorun(() => {
            seen.push(`loading=${store.loading} loaded=${store.loaded}`);
        });

        await cns.stimulate(click.createSignal(0)).waitUntilComplete();
        disposeAutorun();
        off();

        expect(seen).toEqual([
            'loading=true loaded=false', // turn 1: optimistic write IS observed
            'loading=false loaded=true', // turn 2: after the promise settled
        ]);
    });

    it('leaves read-your-writes inside a turn untouched', async () => {
        const store = observable({ n: 0 });
        const readings: number[] = [];

        const a = collateral<number>();
        const b = collateral<number>();

        const writer = neuron({ b }).dendrite({
            collateral: a,
            response: (_p, axon) => {
                runInAction(() => { store.n = 42; });
                return axon.b.createSignal(1);
            },
        });
        const reader = neuron({}).dendrite({
            collateral: b,
            response: () => {
                // Deferring reactions must not defer the write itself.
                readings.push(store.n);
                return undefined;
            },
        });

        const cns = new CNS([writer, reader]);
        const off = wireToDrain(cns);

        await cns.stimulate(a.createSignal(0)).waitUntilComplete();
        off();
        expect(readings).toEqual([42]);
    });

    it('holds reactions created outside a turn until the next drain', async () => {
        const store = observable({ n: 0 });
        const a = collateral<number>();
        const touch = neuron({}).dendrite({
            collateral: a,
            response: () => {
                runInAction(() => { store.n += 1; });
                return undefined;
            },
        });
        const cns = new CNS([touch]);
        const off = wireToDrain(cns);

        const seen: number[] = [];
        const dispose = autorun(() => { seen.push(store.n); });

        // A plain MobX mutation with no stimulation around it: the reaction is
        // queued and stays queued. This is the cost of handing MobX's scheduler
        // to CNStra - it is only correct if CNStra drives your MobX activity.
        runInAction(() => { store.n = 5; });
        expect(seen).toEqual([]);

        await cns.stimulate(a.createSignal(0)).waitUntilComplete();
        dispose();
        off();

        expect(seen).toEqual([6]);
    });
});
