import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type { TCNSStimulationAttempt } from '@cnstra/persist-dto';
import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';
import { transduceSync } from './readSync';

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

const details = async (server: CNSDevToolsServer, runs: number) => {
    const rows = await transduceSync(
        server,
        Array.from({ length: runs }, (_, index) => ({ name: 'stimulationDetail', key: [`run-${index + 1}`] }))
    );
    return rows.map(row => ('data' in row ? (row.data as TCNSDevToolsSyncData['stimulationDetail']) : { attempts: [], tasks: [] }));
};

describe('detail keys do not scale their round trips with their count', () => {
    const build = (store: unknown) => new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), store as never);

    it('reads attempts and tasks once each, whatever the number of keys', async () => {
        const small = countingStore();
        await seed(small.inner, 5);
        await details(build(small.store), 5);

        const large = countingStore();
        await seed(large.inner, 40);
        await details(build(large.store), 40);

        expect(small.calls.getAttemptsFor).toBe(1);
        expect(small.calls.getTasksFor).toBe(1);
        expect(large.calls.getAttemptsFor).toBe(1);
        expect(large.calls.getTasksFor).toBe(1);
    });

    it('never falls back to the per-id reads when the store offers the bulk ones', async () => {
        const s = countingStore();
        await seed(s.inner, 20);
        await details(build(s.store), 20);

        expect(s.calls.getAttempts).toBeUndefined();
        expect(s.calls.getTasks).toBeUndefined();
    });

    it('answers each key with the attempts and tasks of its own run', async () => {
        const s = countingStore();
        await seed(s.inner, 3, 2, 3);
        const answered = await details(build(s.store), 3);

        expect(answered.map(detail => [detail.attempts.length, detail.tasks.length])).toEqual([[2, 6], [2, 6], [2, 6]]);
        expect(answered[1].attempts.every(attempt => attempt.stimulationId === 'run-2')).toBe(true);
        expect(answered[1].tasks.every(task => task.stimulationAttemptId.startsWith('run-2#'))).toBe(true);
    });

    it('still works against a store with only the per-id reads', async () => {
        const s = countingStore();
        await seed(s.inner, 4);
        const limited = new Proxy(s.store, {
            get(target, prop, receiver) {
                if (prop === 'getAttemptsFor' || prop === 'getTasksFor')
                    return undefined;
                return Reflect.get(target, prop, receiver);
            },
        });

        const answered = await details(build(limited), 4);

        expect(answered.map(detail => detail.attempts.length)).toEqual([2, 2, 2, 2]);
        expect(answered.map(detail => detail.tasks.length)).toEqual([6, 6, 6, 6]);
        expect(s.calls.getAttempts).toBe(4);
    });
});
