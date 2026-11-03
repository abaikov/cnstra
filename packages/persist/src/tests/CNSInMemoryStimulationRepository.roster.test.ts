import { CNSInMemoryStimulationRepository } from '.././CNSInMemoryStimulationRepository';
import { loadCNSRosterEntries } from '.././CNSStimulationRosterCompute';
import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
} from '@cnstra/persist-dto';

/**
 * The roster derivation reads every attempt and every task of every run it is
 * handed, and the panel re-runs it on a timer. Two things made that quadratic:
 * `getAttempts` scanned the whole attempt table per run, and the time window was
 * applied only after every run had already been read.
 *
 * These pin the shape rather than a duration: the answer must not change, and
 * the work must stop depending on the size of the store.
 */

const stim = (id: string, scopeName?: string): TCNSStimulationState => ({
    stimulationId: id,
    entry: { collateralName: 'order.created', payload: null },
    status: 'completed',
    progress: { tasks: [] },
    ...(scopeName ? { scopeName } : {}),
});

const attempt = (
    id: string,
    number: number,
    startedAt: number
): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${id}#${number}`,
    stimulationId: id,
    attemptNumber: number,
    status: 'completed',
    startedAt,
    completedAt: startedAt + 10,
    hopCount: 1,
    hasError: false,
    replayOf: null,
    entry: [{ collateralName: 'order.created', payload: null }],
});

const seed = async (
    store: CNSInMemoryStimulationRepository,
    runs: number,
    startedAt = 1_000
) => {
    for (let index = 1; index <= runs; index++) {
        const id = `run-${index}`;
        await store.saveStimulation(stim(id));
        await store.saveAttempt(attempt(id, 1, startedAt + index));
        await store.saveAttempt(attempt(id, 2, startedAt + index));
    }
};

describe('getAttempts', () => {
    it('returns that run attempts, in attempt order', async () => {
        const store = new CNSInMemoryStimulationRepository();
        await seed(store, 3);

        const got = await store.getAttempts('run-2');

        expect(got.map(a => a.stimulationAttemptId)).toEqual([
            'run-2#1',
            'run-2#2',
        ]);
    });

    it('reads only its own run, whatever else the store holds', async () => {
        // The property the scan did not have. A Proxy counts how many attempt
        // rows are touched: through the index it is the run's own two, not the
        // store's two hundred.
        const store = new CNSInMemoryStimulationRepository();
        await seed(store, 100);

        const inner = (store as unknown as { attempts: Map<string, unknown> })
            .attempts;
        let reads = 0;
        (store as unknown as { attempts: unknown }).attempts = new Proxy(inner, {
            get(target, prop, receiver) {
                if (prop === 'get') {
                    return (key: string) => {
                        reads++;
                        return target.get(key);
                    };
                }
                if (prop === 'values') {
                    // A scan would come through here; the index does not.
                    reads += target.size;
                    return target.values.bind(target);
                }
                return Reflect.get(target, prop, receiver);
            },
        });

        await store.getAttempts('run-50');

        expect(reads).toBe(2);
    });

    it('gives back nothing for a run it does not know', async () => {
        const store = new CNSInMemoryStimulationRepository();
        await seed(store, 2);

        expect(await store.getAttempts('never-existed')).toEqual([]);
    });
});

describe('listStimulations with a window', () => {
    it('drops what it can prove is older', async () => {
        const store = new CNSInMemoryStimulationRepository();
        await store.saveStimulation(stim('old'));
        await store.saveAttempt(attempt('old', 1, 1_000));

        // A real gap, not `Date.now() + 1`: the store stamps with `Date.now()`,
        // and both writes land in the same millisecond otherwise.
        await new Promise(resolve => setTimeout(resolve, 5));
        const boundary = Date.now();
        await new Promise(resolve => setTimeout(resolve, 5));
        await store.saveStimulation(stim('fresh'));
        await store.saveAttempt(attempt('fresh', 1, 2_000));

        const kept = await store.listStimulations({ since: boundary });

        expect(kept.map(s => s.stimulationId)).toEqual(['fresh']);
    });

    it('keeps everything when no window is asked for', async () => {
        const store = new CNSInMemoryStimulationRepository();
        await seed(store, 4);

        expect(await store.listStimulations()).toHaveLength(4);
    });

    it('keeps a run whose write is inside the window even if it started before', async () => {
        // The prune is a superset by construction: a write always follows the
        // start, so pruning on the write can only keep too much, never too
        // little. That is what makes it safe to apply before the real filter.
        const store = new CNSInMemoryStimulationRepository();
        const boundary = Date.now();
        await store.saveStimulation(stim('long-running'));
        // Started long ago, written now.
        await store.saveAttempt(attempt('long-running', 1, 1));

        const kept = await store.listStimulations({ since: boundary });

        expect(kept.map(s => s.stimulationId)).toEqual(['long-running']);
    });

    it('still honours the scope alongside the window', async () => {
        const store = new CNSInMemoryStimulationRepository();
        await store.saveStimulation(stim('a', 'app:one'));
        await store.saveAttempt(attempt('a', 1, 1_000));
        await store.saveStimulation(stim('b', 'app:two'));
        await store.saveAttempt(attempt('b', 1, 1_000));

        const kept = await store.listStimulations({
            scopeName: 'app:one',
            since: 0,
        });

        expect(kept.map(s => s.stimulationId)).toEqual(['a']);
    });
});

describe('the roster derivation', () => {
    it('answers the same with the window as it did without', async () => {
        // The prune must change the work, not the result.
        const store = new CNSInMemoryStimulationRepository();
        await seed(store, 5);

        const unwindowed = await loadCNSRosterEntries(store, {});
        const windowed = await loadCNSRosterEntries(store, { since: 0 });

        expect(windowed.map(e => e.row.stimulationId)).toEqual(
            unwindowed.map(e => e.row.stimulationId)
        );
    });

    it('hands the window to the store instead of filtering afterwards', async () => {
        const store = new CNSInMemoryStimulationRepository();
        await seed(store, 3);

        let seen: unknown;
        const watched = new Proxy(store, {
            get(target, prop, receiver) {
                if (prop === 'listStimulations') {
                    return (filter: unknown) => {
                        seen = filter;
                        return target.listStimulations(filter as never);
                    };
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        await loadCNSRosterEntries(watched as never, { since: 1_234 });

        expect(seen).toEqual({ since: 1_234 });
    });
});
