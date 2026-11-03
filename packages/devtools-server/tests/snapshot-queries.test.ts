import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type { TCNSStimulationAttempt } from '@cnstra/persist-dto';

/**
 * The snapshot draws a page of runs with their attempts and tasks. It used to ask
 * the store per run, then per attempt — so a page of 200 runs was hundreds of
 * round trips, and the count grew with the PAGE rather than with the data.
 *
 * These tests count the calls. The point is not a duration — it is that the
 * number of store round trips must not grow when the page does, which is the
 * property that quietly rots the moment someone writes a loop.
 */

const makeWs = (id = 'ws') => {
    const sent: string[] = [];
    return {
        _id: id,
        readyState: 1,
        send: (data: string) => sent.push(data),
        ofType: (t: string) =>
            sent.map(s => JSON.parse(s)).find(m => m.type === t),
    };
};

/** An in-memory store that records every read the server makes. */
const countingStore = () => {
    const inner = new CNSInMemoryStimulationRepository();
    const calls: Record<string, number> = {};
    const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);

    const store = new Proxy(inner, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function' || typeof prop !== 'string')
                return value;
            return (...args: unknown[]) => {
                if (prop.startsWith('get') || prop.startsWith('query'))
                    count(prop);
                return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
        },
    });

    return { store, inner, calls };
};

const seed = async (
    store: CNSInMemoryStimulationRepository,
    runs: number,
    attemptsPerRun = 2,
    tasksPerAttempt = 3
) => {
    for (let r = 1; r <= runs; r++) {
        const stimulationId = `run-${r}`;
        await store.saveStimulation({
            stimulationId,
            entry: { collateralName: 'order.created', payload: null },
            status: 'completed',
            progress: { tasks: [] },
        });
        for (let a = 1; a <= attemptsPerRun; a++) {
            const attempt: TCNSStimulationAttempt = {
                stimulationAttemptId: `${stimulationId}#${a}`,
                stimulationId,
                attemptNumber: a,
                status: 'completed',
                startedAt: 1_000 + r,
                completedAt: 1_100 + r,
                hopCount: tasksPerAttempt,
                hasError: false,
                replayOf: null,
                entry: [{ collateralName: 'order.created', payload: null }],
            };
            await store.saveAttempt(attempt);
            for (let t = 1; t <= tasksPerAttempt; t++) {
                await store.appendTask({
                    stimulationAttemptId: attempt.stimulationAttemptId,
                    index: t,
                    neuronName: `neuron-${t}`,
                    dendriteCollateralName: 'order.created',
                    inputIndex: 0,
                    output: null,
                    status: 'done',
                    error: null,
                    startedAt: 1_000 + r,
                    duration: 1,
                });
            }
        }
    }
};

const snapshot = async (
    server: CNSDevToolsServer,
    ws: ReturnType<typeof makeWs>,
    limit: number,
    skipDetailFor?: string[]
) => {
    await server.handleMessage(
        ws as never,
        JSON.stringify({
            type: 'cns.stimulations.snapshot',
            requestId: 'r1',
            limit,
            ...(skipDetailFor ? { skipDetailFor } : {}),
        })
    );
    return ws.ofType('cns.stimulations.snapshot.result');
};

describe('the snapshot does not scale its round trips with the page', () => {
    const servers: CNSDevToolsServer[] = [];
    afterEach(() => {
        while (servers.length) servers.pop()!.stop();
    });

    const build = (store: unknown) => {
        const server = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            store as never
        );
        servers.push(server);
        return server;
    };

    it('reads attempts and tasks once each, whatever the page size', async () => {
        const small = countingStore();
        await seed(small.inner, 5);
        await snapshot(build(small.store), makeWs(), 50);

        const large = countingStore();
        await seed(large.inner, 40);
        await snapshot(build(large.store), makeWs(), 50);

        // Eight times the runs must not mean eight times the round trips.
        expect(small.calls.getAttemptsFor).toBe(1);
        expect(small.calls.getTasksFor).toBe(1);
        expect(large.calls.getAttemptsFor).toBe(1);
        expect(large.calls.getTasksFor).toBe(1);
    });

    it('never falls back to the per-id reads when the store offers the bulk ones', async () => {
        const s = countingStore();
        await seed(s.inner, 20);
        await snapshot(build(s.store), makeWs(), 50);

        expect(s.calls.getAttempts).toBeUndefined();
        expect(s.calls.getTasks).toBeUndefined();
    });

    it('returns the same flat buckets it always did', async () => {
        const s = countingStore();
        await seed(s.inner, 3, 2, 3);
        const result = await snapshot(build(s.store), makeWs(), 50);

        expect(result.stimulations).toHaveLength(3);
        expect(result.attempts).toHaveLength(6);
        expect(result.tasks).toHaveLength(18);
        // Flat, joined client-side by id — not a nested tree.
        expect(Array.isArray(result.attempts)).toBe(true);
        expect(result.attempts[0].stimulationId).toBeDefined();
        expect(result.tasks[0].stimulationAttemptId).toBeDefined();
    });

    it('still works against a store with only the per-id reads', async () => {
        // The bulk methods are optional; a third-party store without them must
        // keep working, just with more round trips.
        const s = countingStore();
        await seed(s.inner, 4);
        const limited = new Proxy(s.store, {
            get(target, prop, receiver) {
                if (prop === 'getAttemptsFor' || prop === 'getTasksFor')
                    return undefined;
                return Reflect.get(target, prop, receiver);
            },
        });

        const result = await snapshot(build(limited), makeWs(), 50);

        expect(result.stimulations).toHaveLength(4);
        expect(result.attempts).toHaveLength(8);
        expect(result.tasks).toHaveLength(24);
        expect(s.calls.getAttempts).toBe(4);
    });
});

/**
 * The panel polls this every two seconds. Rows are small and always sent — they
 * are what says a run moved — but under `'full'` volume a run contributes one
 * task row per hop, so a page of two hundred fifty-hop runs is ten thousand task
 * rows read out of the store and pushed down the socket every two seconds,
 * almost all identical to the last push because a finished run never changes.
 *
 * `skipDetailFor` is the caller saying which runs it already holds.
 */
describe('the snapshot leaves out the details the caller already has', () => {
    const servers: CNSDevToolsServer[] = [];
    afterEach(() => {
        while (servers.length) servers.pop()!.stop();
    });

    const build = (store: unknown) => {
        const server = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            store as never
        );
        servers.push(server);
        return server;
    };

    it('still sends every row', async () => {
        const s = countingStore();
        await seed(s.inner, 4);

        const result = await snapshot(build(s.store), makeWs(), 50, [
            'run-1',
            'run-2',
            'run-3',
            'run-4',
        ]);

        // All four rows — so a run that moved is visible on this very poll.
        expect(result.stimulations).toHaveLength(4);
        expect(result.attempts).toHaveLength(0);
        expect(result.tasks).toHaveLength(0);
    });

    it('sends the details of exactly the runs not named', async () => {
        const s = countingStore();
        await seed(s.inner, 4);

        const result = await snapshot(build(s.store), makeWs(), 50, [
            'run-1',
            'run-3',
        ]);

        expect(result.stimulations).toHaveLength(4);
        // Two runs, two attempts each, three tasks per attempt.
        expect(result.attempts).toHaveLength(4);
        expect(result.tasks).toHaveLength(12);
        const ids = new Set(result.attempts.map((a: { stimulationId: string }) => a.stimulationId));
        expect([...ids].sort()).toEqual(['run-2', 'run-4']);
    });

    it('does not read the store for a run it was told to skip', async () => {
        // Not only the payload: the read itself is what costs, and on Postgres
        // it is a scan of the task table for those attempts.
        const s = countingStore();
        await seed(s.inner, 4);
        const limited = new Proxy(s.store, {
            get(target, prop, receiver) {
                if (prop === 'getAttemptsFor' || prop === 'getTasksFor')
                    return undefined;
                return Reflect.get(target, prop, receiver);
            },
        });

        await snapshot(build(limited), makeWs(), 50, ['run-1', 'run-2']);

        // Two of the four, not four.
        expect(s.calls.getAttempts).toBe(2);
    });

    it('ignores a skip list naming runs outside the page', async () => {
        const s = countingStore();
        await seed(s.inner, 2);

        const result = await snapshot(build(s.store), makeWs(), 50, [
            'run-1',
            'nonexistent',
        ]);

        expect(result.stimulations).toHaveLength(2);
        expect(result.attempts).toHaveLength(2);
        expect(result.tasks).toHaveLength(6);
    });

    it('shrinks the poll to what actually moved', async () => {
        // The shape from the field: a page of runs with their whole hop history,
        // one of which is still going. The second poll must carry that one run's
        // hops and nobody else's.
        const s = countingStore();
        await seed(s.inner, 60, 1, 50);
        const server = build(s.store);

        const ws1 = makeWs('first');
        const first = await snapshot(server, ws1, 200);
        const settled = first.stimulations
            .map((r: { stimulationId: string }) => r.stimulationId)
            .filter((id: string) => id !== 'run-60');

        const ws2 = makeWs('second');
        const second = await snapshot(server, ws2, 200, settled);

        expect(first.tasks).toHaveLength(60 * 50);
        expect(second.tasks).toHaveLength(50);

        const bytes = (m: unknown) => JSON.stringify(m).length;
        // Rows still travel in full, so the floor is the rows, not zero.
        expect(bytes(second)).toBeLessThan(bytes(first) / 10);
    });

    it('sends everything when the caller names nothing', async () => {
        const s = countingStore();
        await seed(s.inner, 3);

        const result = await snapshot(build(s.store), makeWs(), 50);

        expect(result.attempts).toHaveLength(6);
        expect(result.tasks).toHaveLength(18);
    });
});
