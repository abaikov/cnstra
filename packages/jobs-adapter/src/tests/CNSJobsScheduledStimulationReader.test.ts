import { afterEach, describe, expect, it } from '@jest/globals';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSInMemoryJobRepository } from '@cnstra/jobs';
import type { CNSJobWorker } from '@cnstra/jobs';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { CNSJobs } from '../runtime/CNSJobs';

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() > deadline) throw new Error('condition not met in time');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
};

describe('CNSJobsScheduledStimulationReader', () => {
    const workers: CNSJobWorker[] = [];

    afterEach(async () => {
        await Promise.all(workers.splice(0).map(worker => worker.stop()));
    });

    const setup = () => {
        const input = cnsCollateral<{ id: number }>();
        const step1Out = cnsCollateral<{ id: number }>();
        let failures = 1;
        const n1 = cnsNeuron({ step1Out }).dendrite({
            collateral: input,
            response: (payload, axon) => axon.step1Out.createSignal(payload),
        });
        const n2 = cnsNeuron({}).dendrite({
            collateral: step1Out,
            response: () => {
                if (failures-- > 0) throw new Error('step two failed');
            },
        });
        const registry = new CNSPersistOptionsRegistry();
        registry.register('n1', n1);
        registry.register('n2', n2);
        registry.registerCollateral('input', input);
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns: new CNS([n1, n2]), registry, repository })
            .type(input, { retry: { maxFailed: 3, backoff: { type: 'fixed', delayMs: 60_000 } } })
            .type(step1Out);
        return { jobs, repository, input, step1Out };
    };

    const ids = (page: { rows: Array<{ stimulationId: string }> }) => page.rows.map(row => row.stimulationId);

    it('places a fresh job at the neurons of its collateral and a retried one at the frontier it stopped at', async () => {
        const { jobs, repository, input } = setup();
        const worker = jobs.worker({ pollIntervalMs: 10, promoteIntervalMs: 10, finishBatchMs: 1 });
        workers.push(worker);
        await worker.start();
        await jobs.enqueue(input, { id: 1 }, { jobId: 'failing' });
        await waitFor(async () => (await repository.list({ running: false })).some(jobState => jobState.jobId === 'failing' && jobState.attempts.length === 1));
        await jobs.enqueue(input, { id: 2 }, { jobId: 'fresh', runAfter: Date.now() + 60_000 });
        const reader = jobs.scheduledStimulationReader();

        const all = await reader.list({}, null, 10);

        expect(all.rows.find(row => row.stimulationId === 'fresh')).toMatchObject({
            entry: { collateralName: 'input', payload: { id: 2 } },
            status: 'scheduled',
            attemptCount: 0,
            resumes: false,
            tasks: [{ neuronName: 'n1', dendriteCollateralName: 'input' }],
        });
        expect(all.rows.find(row => row.stimulationId === 'failing')).toMatchObject({
            status: 'scheduled',
            attemptCount: 1,
            resumes: true,
            tasks: [{ neuronName: 'n2', dendriteCollateralName: 'n1.step1Out' }],
        });
        expect(ids(await reader.list({ neuronName: 'n1' }, null, 10))).toEqual(['fresh']);
        expect(ids(await reader.list({ neuronName: 'n2' }, null, 10))).toEqual(['failing']);
        expect(ids(await reader.list({ collateralName: 'n1.step1Out' }, null, 10))).toEqual(['failing']);
        expect(ids(await reader.list({ collateralName: 'input' }, null, 10)).sort()).toEqual(['failing', 'fresh']);
    });

    it('pages through the scheduled jobs and lists the schedules of the filtered collateral on the first page', async () => {
        const { jobs, repository, input } = setup();
        await repository.upsertSchedules('n1.step1Out', [{ scheduleId: 'hourly', everyMs: 3_600_000 }], false);
        await jobs.enqueue(input, { id: 1 }, { jobId: 'a', runAfter: 1 });
        await jobs.enqueue(input, { id: 2 }, { jobId: 'b', runAfter: 2 });
        await jobs.enqueue(input, { id: 3 }, { jobId: 'c', runAfter: 3 });
        const reader = jobs.scheduledStimulationReader();

        const first = await reader.list({ neuronName: 'n1' }, null, 2);
        const second = await reader.list({ neuronName: 'n1' }, first.nextCursor, 2);

        expect(ids(first)).toEqual(['a', 'b']);
        expect(first.schedules).toEqual([]);
        expect(ids(second)).toEqual(['c']);
        expect(second.nextCursor).toBeNull();
        expect((await reader.list({ neuronName: 'n2' }, null, 2)).schedules).toEqual([{ scheduleId: 'hourly', collateralName: 'n1.step1Out', everyMs: 3_600_000 }]);
        expect((await reader.list({ collateralName: 'n1.step1Out' }, null, 2)).schedules).toHaveLength(1);
        expect((await reader.list({ collateralName: 'n1.step1Out' }, null, 2)).rows).toEqual([]);
    });
    it('returns an empty page with a cursor when the scan stops before a match, and the cursor reaches it', async () => {
        const { jobs, input, step1Out } = setup();
        for (let index = 0; index < 25; index++) await jobs.enqueue(input, { id: index }, { jobId: `input-${index}`, runAfter: index });
        await jobs.enqueue(step1Out, { id: 99 }, { jobId: 'step', runAfter: 100 });
        const reader = jobs.scheduledStimulationReader();

        const first = await reader.list({ neuronName: 'n2' }, null, 1);
        const second = await reader.list({ neuronName: 'n2' }, first.nextCursor, 1);

        expect(first.rows).toEqual([]);
        expect(first.nextCursor).not.toBeNull();
        expect(ids(second)).toEqual(['step']);
    });
    it('lists the declared job types with their payload schema on the first page, narrowed like the schedules', async () => {
        const input = cnsCollateral<{ id: number }>();
        const step1Out = cnsCollateral<{ id: number }>();
        const n1 = cnsNeuron({ step1Out }).dendrite({ collateral: input, response: (payload, axon) => axon.step1Out.createSignal(payload) });
        const n2 = cnsNeuron({}).dendrite({ collateral: step1Out, response: () => undefined });
        const registry = new CNSPersistOptionsRegistry();
        registry.register('n1', n1);
        registry.register('n2', n2);
        registry.registerCollateral('input', input);
        const jobs = new CNSJobs({ cns: new CNS([n1, n2]), registry, repository: new CNSInMemoryJobRepository() })
            .type(input, { payloadSchema: { type: 'object' }, description: 'starts the flow' })
            .type(step1Out);
        const reader = jobs.scheduledStimulationReader();

        expect((await reader.list({}, null, 5)).types).toEqual([
            { collateralName: 'input', description: 'starts the flow', payloadSchema: { type: 'object' } },
            { collateralName: 'n1.step1Out' },
        ]);
        expect((await reader.list({ neuronName: 'n2' }, null, 5)).types).toEqual([{ collateralName: 'n1.step1Out' }]);
        expect((await reader.list({}, '1:1', 5)).types).toEqual([]);
    });
});
