import { CNSInMemoryStimulationRepository } from '.././CNSInMemoryStimulationRepository';
import { buildCNSTimeHistogram } from '.././CNSStimulationRosterCompute';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSStimulationRosterRow,
} from '@cnstra/persist-dto';

const stim = (
    stimulationId: string,
    status: string
): TCNSStimulationState => ({
    stimulationId,
    entry: { collateralName: 'c', payload: {} },
    status: status as TCNSStimulationState['status'],
    progress: { tasks: [] },
});

const attempt = (
    stimulationId: string,
    status: string,
    done: boolean
): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${stimulationId}#1`,
    stimulationId,
    attemptNumber: 1,
    status: status as TCNSStimulationAttempt['status'],
    startedAt: 1,
    completedAt: done ? 2 : null,
    hopCount: 1,
    hasError: status === 'failed',
    replayOf: null,
    entry: [{ collateralName: 'c', payload: {} }],
});

const task = (
    stimulationAttemptId: string,
    index = 0
): TCNSStimulationTask => ({
    stimulationAttemptId,
    index,
    neuronName: 'n',
    dendriteCollateralName: 'c',
    inputIndex: 0,
    output: null,
    status: 'done',
    error: null,
    startedAt: 1,
    duration: null,
});

describe('CNSInMemoryStimulationRepository — bounds (OOM prevention)', () => {
    it('maxStimulations evicts the least-recently-updated', async () => {
        const repo = new CNSInMemoryStimulationRepository({ maxStimulations: 2 });
        for (const id of ['a', 'b', 'c', 'd'])
            await repo.saveStimulation(stim(id, 'running'));
        const ids = (await repo.listStimulations()).map(s => s.stimulationId);
        expect(ids).toEqual(['d', 'c']); // newest-first, oldest evicted
        // evicted stimulations' attempts/tasks are gone too
        expect(await repo.getStimulation('a')).toBeUndefined();
    });

    it('deleteOnComplete drops a stimulation (and its attempts/tasks) when it settles', async () => {
        const repo = new CNSInMemoryStimulationRepository({
            deleteOnComplete: true,
        });
        await repo.saveStimulation(stim('x', 'running'));
        await repo.saveAttempt(attempt('x', 'running', false));
        expect((await repo.listStimulations())).toHaveLength(1); // in-flight retained

        await repo.saveStimulation(stim('x', 'completed'));
        await repo.saveAttempt(attempt('x', 'completed', true)); // terminal → purge
        expect(await repo.listStimulations()).toHaveLength(0);
        expect(await repo.getAttempts('x')).toEqual([]);
        expect(await repo.getTasks('x#1')).toEqual([]);
    });

    it('deleteOnComplete also drops permanently-failed stimulations', async () => {
        const repo = new CNSInMemoryStimulationRepository({
            deleteOnComplete: true,
        });
        await repo.saveStimulation(stim('f', 'failed'));
        await repo.saveAttempt(attempt('f', 'failed', true));
        expect(await repo.listStimulations()).toHaveLength(0);
    });

    it('ttlMs sweeps idle stimulations on the next write', async () => {
        const repo = new CNSInMemoryStimulationRepository({ ttlMs: 30 });
        await repo.saveStimulation(stim('old', 'running'));
        await new Promise(r => setTimeout(r, 50));
        await repo.saveStimulation(stim('new', 'running')); // write triggers the sweep
        const ids = (await repo.listStimulations()).map(s => s.stimulationId);
        expect(ids).toEqual(['new']);
    });

    it('unbounded by default (backwards-compatible)', async () => {
        const repo = new CNSInMemoryStimulationRepository();
        for (let i = 0; i < 50; i++)
            await repo.saveStimulation(stim(`s${i}`, 'completed'));
        expect(await repo.listStimulations()).toHaveLength(50);
    });

    it('appending a task keeps its run out of the eviction firing line', async () => {
        const repo = new CNSInMemoryStimulationRepository({
            maxStimulations: 2,
        });
        for (const id of ['a', 'b']) {
            await repo.saveStimulation(stim(id, 'running'));
            await repo.saveAttempt(attempt(id, 'running', false));
        }
        // 'a' is a long run whose attempt flushes are debounced — tasks are all it
        // writes for a while. That has to count as activity.
        await repo.appendTask(task('a#1'));

        await repo.saveStimulation(stim('c', 'running')); // over cap → evict LRU
        const ids = (await repo.listStimulations()).map(s => s.stimulationId);
        expect(ids).toContain('a');
        expect(ids).not.toContain('b');
    });

    it('tasks appended after their run was evicted do not leak an unreachable bucket', async () => {
        const repo = new CNSInMemoryStimulationRepository({
            maxStimulations: 1,
        });
        await repo.saveStimulation(stim('a', 'running'));
        await repo.saveAttempt(attempt('a', 'running', false));
        await repo.appendTask(task('a#1'));

        // A newer run evicts 'a' whole, task bucket included.
        await repo.saveStimulation(stim('b', 'running'));
        await repo.saveAttempt(attempt('b', 'running', false));
        expect(await repo.getStimulation('a')).toBeUndefined();
        expect(await repo.getTasks('a#1')).toEqual([]);

        // In-flight tasks for the now-dead attempt keep arriving; they must not
        // re-grow the store past the cap, and nothing owns them to purge them.
        for (let i = 1; i <= 5; i++) await repo.appendTask(task('a#1', i));
        for (const id of ['x#1', 'y#1', 'z#1'])
            await repo.appendTask(task(id));

        expect(await repo.getTasks('a#1')).toEqual([]);
        expect(repo.taskBucketCount).toBeLessThanOrEqual(1);
    });
});

describe('buildCNSTimeHistogram — large result sets', () => {
    it('handles 200_000 rows without a RangeError from a spread call', () => {
        const rows: TCNSStimulationRosterRow[] = Array.from(
            { length: 200_000 },
            (_, i) => ({
                stimulationId: `s${i}`,
                entry: { collateralName: 'c', payload: {} },
                status: 'completed',
                startedAt: 1_000 + i,
                completedAt: null,
                hopCount: 1,
                hasError: false,
            })
        );
        const buckets = buildCNSTimeHistogram(rows);
        expect(buckets.length).toBeGreaterThan(0);
        expect(buckets.length).toBeLessThanOrEqual(41);
        expect(buckets.reduce((n, b) => n + b.completed, 0)).toBe(200_000);
    });
});
