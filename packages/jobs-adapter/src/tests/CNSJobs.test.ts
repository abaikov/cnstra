import { afterEach, describe, expect, it } from '@jest/globals';
import { CNS, collateral, neuron } from '@cnstra/core';
import { CNSInMemoryJobRepository } from '@cnstra/jobs';
import type { CNSJobWorker, TCNSJobHistoryState } from '@cnstra/jobs';
import type { TCNSDevToolsAction } from '@cnstra/persist-dto';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { CNSJobs } from '../runtime/CNSJobs';
import type { TCNSJobsCompletionState } from '../types/TCNSJobsCompletionState';
import type { TCNSJobsFailureState } from '../types/TCNSJobsFailureState';

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() > deadline) throw new Error('condition not met in time');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
};

const flow = (failures: { left: number }) => {
    const input = collateral<{ id: number }>();
    const step1Out = collateral<{ id: number }>();
    const output = collateral<{ result: string }>();
    const completed = collateral<TCNSJobsCompletionState<{ id: number }>>();
    const failed = collateral<TCNSJobsFailureState<{ id: number }>>();
    const ran: string[] = [];
    const continuations: unknown[] = [];

    const n1 = neuron({ step1Out }).dendrite({
        collateral: input,
        response: (payload, axon) => {
            ran.push('n1');
            return axon.step1Out.createSignal({ id: payload.id });
        },
    });
    const n2 = neuron({ output }).dendrite({
        collateral: step1Out,
        response: (payload, axon) => {
            ran.push('n2');
            if (failures.left-- > 0) throw new TypeError('step two failed');
            return axon.output.createSignal({ result: `ok-${payload.id}` });
        },
    });
    const onCompleted = neuron({}).dendrite({
        collateral: completed,
        response: payload => void continuations.push(['completed', payload]),
    });
    const onFailed = neuron({}).dendrite({
        collateral: failed,
        response: payload => void continuations.push(['failed', payload]),
    });

    const cns = new CNS([n1, n2, onCompleted, onFailed]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('n1', n1);
    registry.register('n2', n2);
    registry.registerCollateral('input', input);
    return { cns, registry, input, completed, failed, ran, continuations };
};

describe('CNSJobs', () => {
    const workers: CNSJobWorker[] = [];

    afterEach(async () => {
        await Promise.all(workers.splice(0).map(worker => worker.stop()));
    });

    const start = async (jobs: CNSJobs) => {
        const worker = jobs.worker({ pollIntervalMs: 10, promoteIntervalMs: 10, finishBatchMs: 1 });
        workers.push(worker);
        await worker.start();
        return worker;
    };

    const finished = async (repository: CNSInMemoryJobRepository, jobId: string) => {
        const found = await repository.get(jobId);
        return found !== undefined && 'finalStatus' in found ? (found as TCNSJobHistoryState) : undefined;
    };

    it('runs a job of an entry collateral as one stimulation and continues with onCompleted', async () => {
        const { cns, registry, input, completed, ran, continuations } = flow({ left: 0 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository }).type(input, { onCompleted: completed });
        await start(jobs);

        const result = await jobs.enqueue(input, { id: 7 });
        await waitFor(() => continuations.length === 1);

        expect(ran).toEqual(['n1', 'n2']);
        expect((await finished(repository, result?.jobId ?? ''))?.finalStatus).toBe('completed');
        expect(continuations).toEqual([['completed', { jobId: result?.jobId, payload: { id: 7 } }]]);
    });

    it('resumes a retried job from the frontier its failed attempt left', async () => {
        const { cns, registry, input, ran } = flow({ left: 1 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository }).type(input, { retry: { maxFailed: 3, backoff: { type: 'fixed', delayMs: 1 } } });
        await start(jobs);

        const result = await jobs.enqueue(input, { id: 1 });
        await waitFor(async () => (await finished(repository, result?.jobId ?? '')) !== undefined);

        expect(ran).toEqual(['n1', 'n2', 'n2']);
        expect((await finished(repository, result?.jobId ?? ''))?.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
        expect(await repository.stateRepository.load(result?.jobId ?? '')).toBeUndefined();
    });

    it('records where in the graph an attempt failed and passes it to onFailed', async () => {
        const { cns, registry, input, failed, continuations } = flow({ left: 10 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository }).type(input, { retry: { maxFailed: 1 }, onFailed: failed });
        await start(jobs);

        const result = await jobs.enqueue(input, { id: 2 });
        await waitFor(() => continuations.length === 1);

        expect((await finished(repository, result?.jobId ?? ''))?.attempts[0]).toMatchObject({
            status: 'failed',
            errorName: 'TypeError',
            meta: { failedNeuron: 'n2', failedCollateral: 'n1.step1Out' },
        });
        expect(continuations).toEqual([
            ['failed', { jobId: result?.jobId, payload: { id: 2 }, errorName: 'TypeError', failedNeuron: 'n2', failedCollateral: 'n1.step1Out' }],
        ]);
    });

    it('links a job enqueued from a neuron to the stimulation that enqueued it', async () => {
        const parentInput = collateral<{ orderId: number }>();
        const childInput = collateral<{ orderId: number }>();
        const seen: unknown[] = [];
        const registry = new CNSPersistOptionsRegistry();
        const repository = new CNSInMemoryJobRepository();
        let jobs: CNSJobs | undefined;
        const parent = neuron({}).dendrite({
            collateral: parentInput,
            response: async (payload, _axon, context) => {
                await jobs?.from(context).enqueue(childInput, { orderId: payload.orderId });
            },
        });
        const child = neuron({}).dendrite({
            collateral: childInput,
            response: (_payload, _axon, context) => void seen.push(context.stimulationContext),
        });
        registry.register('parent', parent);
        registry.register('child', child);
        registry.registerCollateral('parentInput', parentInput);
        registry.registerCollateral('childInput', childInput);
        jobs = new CNSJobs({ cns: new CNS([parent, child]), registry, repository }).type(parentInput).type(childInput);
        await start(jobs);

        const result = await jobs.enqueue(parentInput, { orderId: 5 });
        await waitFor(() => seen.length === 1);

        expect(seen[0]).toMatchObject({ parentStimulationId: result?.jobId, parentAttemptId: `${result?.jobId}#1` });
    });

    it('lets a type refuse retries by the class of the error its neuron threw', async () => {
        const { cns, registry, input, ran } = flow({ left: 10 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository }).type(input, { retry: { maxFailed: 5, nonRetryable: ['TypeError'] } });
        await start(jobs);

        const result = await jobs.enqueue(input, { id: 3 });
        await waitFor(async () => (await finished(repository, result?.jobId ?? '')) !== undefined);

        expect(ran).toEqual(['n1', 'n2']);
        expect((await finished(repository, result?.jobId ?? ''))?.finalStatus).toBe('failed');
    });

    it('aborts the stimulation of a cancelled job', async () => {
        const slowInput = collateral<{ id: number }>();
        let signal: AbortSignal | undefined;
        const slow = neuron({}).dendrite({
            collateral: slowInput,
            response: (_payload, _axon, context) =>
                new Promise<void>((_, reject) => {
                    signal = context.abortSignal;
                    context.abortSignal?.addEventListener('abort', () => reject(context.abortSignal?.reason));
                }),
        });
        const registry = new CNSPersistOptionsRegistry();
        registry.register('slow', slow);
        registry.registerCollateral('slowInput', slowInput);
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns: new CNS([slow]), registry, repository }).type(slowInput);
        await start(jobs);

        const result = await jobs.enqueue(slowInput, { id: 4 });
        await waitFor(() => signal !== undefined);
        await repository.cancel([result?.jobId ?? '']);
        await waitFor(async () => (await finished(repository, result?.jobId ?? '')) !== undefined);

        expect(signal?.aborted).toBe(true);
        expect((await finished(repository, result?.jobId ?? ''))?.finalStatus).toBe('cancelled');
    });

    it('refuses a payload of the wrong type, a type after the worker, and a continuation without history', () => {
        const { cns, registry, input, completed } = flow({ left: 0 });
        const jobs = new CNSJobs({ cns, registry, repository: new CNSInMemoryJobRepository() });
        // @ts-expect-error the payload of input is { id: number }
        void jobs.enqueue(input, { id: 'one' }).catch(() => undefined);
        const withoutHistory = new CNSJobs({ cns, registry, repository: new CNSInMemoryJobRepository({ history: false }) });
        expect(() => withoutHistory.type(input, { onCompleted: completed })).toThrow('keeps history');
        jobs.worker();
        expect(() => jobs.type(input)).toThrow('before creating a worker');
    });

    it('refuses a collateral that is not in the registry', () => {
        const { cns, registry } = flow({ left: 0 });
        const jobs = new CNSJobs({ cns, registry, repository: new CNSInMemoryJobRepository() });

        expect(() => jobs.type(collateral<{ id: number }>())).toThrow('not registered');
    });
    it('waits for a job to finish and hands back its history', async () => {
        const { cns, registry, input } = flow({ left: 0 });
        const jobs = new CNSJobs({ cns, registry, repository: new CNSInMemoryJobRepository() }).type(input);
        await start(jobs);

        const result = await jobs.enqueue(input, { id: 3 });

        await expect(jobs.waitFor(result?.jobId ?? '')).resolves.toMatchObject({ jobType: 'input', payload: { id: 3 }, finalStatus: 'completed' });
    });

    it('runs every collateral a registered neuron listens to with the default type options, an explicit type winning', async () => {
        const { cns, registry, input, ran } = flow({ left: 2 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository, defaultTypeOptions: { retry: { maxFailed: 1 } } }).type(input, {
            retry: { maxFailed: 3, backoff: { type: 'fixed', delayMs: 1 } },
        });
        await start(jobs);

        const step = await jobs.enqueue(registry.getCollateral('n1.step1Out') as typeof input, { id: 2 });
        const stepState = await jobs.waitFor(step?.jobId ?? '');
        const entry = await jobs.enqueue(input, { id: 1 });
        const entryState = await jobs.waitFor(entry?.jobId ?? '');

        expect(stepState.finalStatus).toBe('failed');
        expect(entryState.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
        expect(ran).toEqual(['n2', 'n1', 'n2', 'n2']);
    });

    it('carries out panel actions: retries its own finished job from the frontier, launches a declared type, passes the rest on', async () => {
        const { cns, registry, input, ran } = flow({ left: 1 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository }).type(input);
        await start(jobs);
        const actions = jobs.actions();
        const passed: string[] = [];
        const run = (action: Partial<TCNSDevToolsAction>) => actions(action as TCNSDevToolsAction, async () => void passed.push(action.stimulationId ?? ''));

        const failed = await jobs.enqueue(input, { id: 1 });
        await jobs.waitFor(failed?.jobId ?? '');
        await run({ type: 'resume', stimulationId: failed?.jobId });
        const resumed = await jobs.waitFor(failed?.jobId ?? '');
        await run({ type: 'launch', stimulationId: 'clone-1', entry: { collateralName: 'input', payload: { id: 5 } } });
        const launched = await jobs.waitFor('clone-1');
        await run({ type: 'launch', stimulationId: 'clone-2', entry: { collateralName: 'input', payload: { id: 6 } }, options: { maxHops: 1 } });
        const bounded = await jobs.waitFor('clone-2');
        await run({ type: 'launch', stimulationId: 'other-launch', entry: { collateralName: 'output', payload: {} } });
        await run({ type: 'resume', stimulationId: 'other-run' });

        expect(resumed.attempts.map(attempt => attempt.status)).toEqual(['failed', 'retried', 'completed']);
        expect(launched).toMatchObject({ payload: { id: 5 }, finalStatus: 'completed' });
        expect(bounded.meta).toEqual({ maxNeuronHops: 1 });
        expect(ran).toEqual(['n1', 'n2', 'n2', 'n1', 'n2', 'n1', 'n2']);
        expect(passed).toEqual(['other-launch', 'other-run']);
    });
    it('carries out panel commands on a waiting job: run now, prioritize, cancel; refuses them on a finished job', async () => {
        const { cns, registry, input, ran } = flow({ left: 0 });
        const repository = new CNSInMemoryJobRepository();
        const jobs = new CNSJobs({ cns, registry, repository }).type(input);
        await start(jobs);
        const actions = jobs.actions();
        const passed: string[] = [];
        const command = (stimulationId: string, value: any) =>
            actions({ type: 'command', requestId: 'r', stimulationId, command: value } as TCNSDevToolsAction, async () => void passed.push(stimulationId));

        await jobs.enqueue(input, { id: 1 }, { jobId: 'later', runAfter: Date.now() + 60_000 });
        await jobs.enqueue(input, { id: 2 }, { jobId: 'doomed', runAfter: Date.now() + 60_000 });
        await command('later', { name: 'prioritize', priority: 7 });
        const prioritized = await repository.get('later');
        await command('later', { name: 'runNow' });
        const finished = await jobs.waitFor('later');
        await command('doomed', { name: 'cancel' });
        await command('nobody', { name: 'runNow' });

        expect(prioritized).toMatchObject({ priority: 7 });
        expect(finished.finalStatus).toBe('completed');
        expect(ran).toEqual(['n1', 'n2']);
        expect(await repository.get('doomed')).toMatchObject({ finalStatus: 'cancelled' });
        await expect(command('later', { name: 'cancel' })).rejects.toThrow('has already finished');
        expect(passed).toEqual(['nobody']);
    });
});
