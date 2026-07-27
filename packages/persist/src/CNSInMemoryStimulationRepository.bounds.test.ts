import { CNSInMemoryStimulationRepository } from './CNSInMemoryStimulationRepository';
import type {
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
} from '@cnstra/persist-dto';

const stim = (
    stimulationId: string,
    status: string
): TCNSStimulationPersisted => ({
    stimulationId,
    entry: { collateralName: 'c', payload: {} },
    status: status as TCNSStimulationPersisted['status'],
    progress: { tasks: [], context: {} },
});

const attempt = (
    stimulationId: string,
    status: string,
    done: boolean
): TCNSStimulationAttemptPersisted => ({
    stimulationAttemptId: `${stimulationId}#1`,
    stimulationId,
    attemptNumber: 1,
    status: status as TCNSStimulationAttemptPersisted['status'],
    startedAt: 1,
    completedAt: done ? 2 : null,
    hopCount: 1,
    hasError: status === 'failed',
    replayOf: null,
    entry: [{ collateralName: 'c', payload: {} }],
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

    it('deleteOnComplete drops a run (and its attempts/tasks) when it settles', async () => {
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

    it('deleteOnComplete also drops permanently-failed runs', async () => {
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
});
