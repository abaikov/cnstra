import { describe, expect, it, jest } from '@jest/globals';
import { CNSInMemoryJobLogRepository } from '../repository/CNSInMemoryJobLogRepository';
import { CNSInMemoryJobRepository } from '../repository/CNSInMemoryJobRepository';
import { CNSJobQueue } from '../runtime/CNSJobQueue';
import type { TCNSJobEnqueueMiddleware } from '../types/TCNSJobEnqueueMiddleware';
import type { TCNSJobEvent } from '../types/TCNSJobEvent';
import type { TCNSJobState } from '../types/TCNSJobState';
import type { TCNSJobTypeDefinition } from '../types/TCNSJobTypeDefinition';

const mail: TCNSJobTypeDefinition<{ user: string; n: number }> = {
    jobType: 'mail',
    jobKey: payload => payload.user,
    jobGroup: payload => `group-${payload.user}`,
    keyMode: 'latest',
    priority: 3,
    retry: { maxFailed: 4 },
};

const setup = (middlewares: TCNSJobEnqueueMiddleware[] = []) => {
    const repository = new CNSInMemoryJobRepository();
    const logRepository = repository.logRepository;
    const queue = new CNSJobQueue({ repository, definitions: [mail as TCNSJobTypeDefinition], middlewares });
    const events: TCNSJobEvent[] = [];
    queue.on('*', event => events.push(event));
    return { repository, logRepository, queue, events };
};

describe('CNSJobQueue', () => {
    it('fills key, group, priority and retry from the type definition, letting the job override them', async () => {
        const { queue } = setup();

        const fromDefinition = await queue.enqueue({ jobType: 'mail', payload: { user: 'u1', n: 1 } });
        const overridden = await queue.enqueue({ jobType: 'mail', payload: { user: 'u2', n: 1 }, priority: 9, retry: { maxFailed: 1 } });

        const first = (await queue.get(fromDefinition?.jobId ?? '')) as TCNSJobState;
        const second = (await queue.get(overridden?.jobId ?? '')) as TCNSJobState;
        expect(first).toMatchObject({ jobKey: 'u1', jobGroup: 'group-u1', priority: 3, retry: { maxFailed: 4 } });
        expect(second).toMatchObject({ jobKey: 'u2', priority: 9, retry: { maxFailed: 1 } });
    });

    it('applies the key mode of the definition and emits what happened', async () => {
        const { queue, events } = setup();

        const first = await queue.enqueue({ jobType: 'mail', payload: { user: 'u1', n: 1 }, runAfter: Date.now() + 60_000 });
        const second = await queue.enqueue({ jobType: 'mail', payload: { user: 'u1', n: 2 } });
        const third = await queue.enqueue({ jobType: 'mail', payload: { user: 'u1', n: 3 }, jobId: first?.jobId });

        expect([first?.status, second?.status, third?.status]).toEqual(['inserted', 'replaced', 'deduplicated']);
        expect(events.map(event => [event.name, event.jobId, event.jobGroup])).toEqual([
            ['job.enqueued', first?.jobId, 'group-u1'],
            ['job.replaced', first?.jobId, 'group-u1'],
            ['job.deduplicated', first?.jobId, 'group-u1'],
        ]);
    });

    it('emits job.superseded for heads replaced by a newer job', async () => {
        const { queue, repository, events } = setup();
        const head = await queue.enqueue({ jobType: 'mail', payload: { user: 'u1', n: 1 } });
        const { claimed } = await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 1000 }], 'w');
        await repository.finish([{ jobId: claimed[0].jobId, seq: claimed[0].seq, attemptNumber: 1, kind: 'requeue', attemptStatus: 'failed', runAfter: Date.now() + 60_000 }]);

        await queue.enqueue({ jobType: 'mail', payload: { user: 'u1', n: 2 } });

        expect(events.filter(event => event.name === 'job.superseded').map(event => event.jobId)).toEqual([head?.jobId]);
    });

    it('lets middleware change a request and drop one without stopping the batch', async () => {
        const { queue, repository, events } = setup([
            async (request, next) => {
                if (request.job.meta?.drop) return;
                request.job.meta = { ...request.job.meta, seen: true };
                await next();
            },
        ]);

        const results = await queue.enqueueMany([
            { jobType: 'sms', payload: 1 },
            { jobType: 'sms', payload: 2, meta: { drop: true } },
            { jobType: 'sms', payload: 3 },
        ]);

        expect(results.map(result => result?.status)).toEqual(['inserted', undefined, 'inserted']);
        expect(((await repository.get(results[0]?.jobId ?? '')) as TCNSJobState).meta).toEqual({ seen: true });
        const { claimed } = await repository.claim([{ jobType: 'sms', free: 10, leaseMs: 1000 }], 'w');
        expect(claimed.map(jobState => jobState.payload)).toEqual([1, 3]);
        expect(events.map(event => event.name)).toEqual(['job.enqueued', 'job.enqueued']);
    });

    it('keeps concurrent enqueues apart while middleware awaits', async () => {
        const { queue } = setup([
            async (request, next) => {
                await new Promise(resolve => setTimeout(resolve, request.job.payload === 'slow' ? 20 : 1));
                await next();
            },
        ]);

        const [slow, fast] = await Promise.all([
            queue.enqueue({ jobType: 'sms', payload: 'slow', jobId: 'slow' }),
            queue.enqueue({ jobType: 'sms', payload: 'fast', jobId: 'fast' }),
        ]);

        expect([slow?.jobId, fast?.jobId]).toEqual(['slow', 'fast']);
    });

    it('propagates a middleware rejection and enqueues nothing', async () => {
        const { queue, repository } = setup([
            async () => {
                throw new Error('rejected');
            },
        ]);

        await expect(queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'x' })).rejects.toThrow('rejected');
        expect(await repository.get('x')).toBeUndefined();
    });

    it('cancels, retries and removes with events, and removes logs with the job', async () => {
        const { queue, logRepository, events } = setup();
        await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });
        await logRepository.append('a', [{ attemptNumber: 1, seq: 1, at: 0, kind: 'log' }]);

        expect(await queue.cancel(['a'])).toEqual({ cancelled: ['a'], requested: [] });
        expect(await queue.retry(['a'])).toEqual(['a']);
        expect(await queue.remove(['a'])).toEqual(['a']);

        expect(events.map(event => event.name)).toEqual(['job.enqueued', 'job.cancelled', 'job.retried', 'job.removed']);
        expect(await queue.logs('a')).toEqual([]);
    });

    it('emits the transitions an enqueue reports with the type of the job that made them', async () => {
        const repository = new CNSInMemoryJobRepository();
        const enqueue = repository.enqueue.bind(repository);
        repository.enqueue = async requests => {
            const results = await enqueue(requests);
            results[0].transitions = [{ jobId: 'head', seq: 1, jobType: 'mail', attemptNumber: 1, finalStatus: 'superseded' }];
            return results;
        };
        const queue = new CNSJobQueue({ repository });
        const events: TCNSJobEvent[] = [];
        queue.on('*', event => events.push(event));

        await queue.enqueue({ jobType: 'sms', payload: 1 });

        expect(events.map(event => [event.name, event.jobId, event.jobType])).toEqual([
            ['job.superseded', 'head', 'mail'],
            ['job.enqueued', expect.any(String), 'sms'],
        ]);
    });

    it('emits the transitions a cancel reports before the cancel itself', async () => {
        const repository = new CNSInMemoryJobRepository();
        const cancel = repository.cancel.bind(repository);
        repository.cancel = async (jobIds, as) => ({
            ...(await cancel(jobIds, as)),
            transitions: [{ jobId: 'head', seq: 1, jobType: 'mail', attemptNumber: 1, finalStatus: 'superseded' }],
        });
        const queue = new CNSJobQueue({ repository });
        await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });
        const events: TCNSJobEvent[] = [];
        queue.on('*', event => events.push(event));

        await queue.cancel(['a']);

        expect(events.map(event => [event.name, event.jobId])).toEqual([
            ['job.superseded', 'head'],
            ['job.cancelled', 'a'],
        ]);
    });

    it('resolves remove only after the log store has deleted the logs', async () => {
        const logRepository = new CNSInMemoryJobLogRepository();
        const deleteLogs = logRepository.delete.bind(logRepository);
        const deleted: string[] = [];
        logRepository.delete = async jobIds => {
            await new Promise(resolve => setTimeout(resolve, 10));
            deleted.push(...jobIds);
            return deleteLogs(jobIds);
        };
        const queue = new CNSJobQueue({ repository: new CNSInMemoryJobRepository({ logRepository }) });
        await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });

        await queue.remove(['a']);

        expect(deleted).toEqual(['a']);
    });
    it('waits for a job to finish and resolves with its history, at once when it already has', async () => {
        const { queue } = setup();
        await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });
        await queue.enqueue({ jobType: 'sms', payload: 2, jobId: 'b' });
        await queue.cancel(['b']);

        const waiting = queue.waitFor('a');
        await queue.cancel(['a']);

        await expect(waiting).resolves.toMatchObject({ jobId: 'a', payload: 1, finalStatus: 'cancelled' });
        await expect(queue.waitFor('b')).resolves.toMatchObject({ jobId: 'b', finalStatus: 'cancelled' });
    });

    it('rejects waiting for a job the repository does not hold, or without history', async () => {
        const { queue } = setup();
        const withoutHistory = new CNSJobQueue({ repository: new CNSInMemoryJobRepository({ history: false }) });

        await expect(queue.waitFor('missing')).rejects.toThrow('job "missing" is not in the repository');
        await expect(withoutHistory.waitFor('a')).rejects.toThrow('needs a repository that keeps history');
    });

    it('stops waiting with the reason of the abort signal', async () => {
        const { queue } = setup();
        await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });
        const controller = new AbortController();
        const aborted = new AbortController();
        aborted.abort(new Error('gone before'));

        const waiting = queue.waitFor('a', controller.signal);
        controller.abort(new Error('neuron stopped'));

        await expect(waiting).rejects.toThrow('neuron stopped');
        await expect(queue.waitFor('a', aborted.signal)).rejects.toThrow('gone before');
    });

    it('wakes on the done notification of the job it waits for, long before its poll', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        try {
            const { queue } = setup();
            await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });
            const outcome = queue.waitFor('a').then(finished => finished.finalStatus);
            await jest.advanceTimersByTimeAsync(0);
            await queue.cancel(['a']);

            expect(await Promise.race([outcome, new Promise(resolve => setImmediate(() => resolve('still waiting')))])).toBe('cancelled');
        } finally {
            jest.useRealTimers();
        }
    });

    it('notices a job removed without a done notification on its next poll', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        try {
            const { queue } = setup();
            await queue.enqueue({ jobType: 'sms', payload: 1, jobId: 'a' });
            const waiting = queue.waitFor('a');
            const outcome = waiting.catch((error: Error) => error.message);
            await jest.advanceTimersByTimeAsync(0);
            await queue.remove(['a']);

            await jest.advanceTimersByTimeAsync(5_000);

            expect(await outcome).toMatch('job "a" is not in the repository');
        } finally {
            jest.useRealTimers();
        }
    });
});
