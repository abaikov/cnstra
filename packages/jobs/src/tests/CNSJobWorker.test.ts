import { afterEach, describe, expect, it } from '@jest/globals';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import { CNSInMemoryJobRepository } from '../repository/CNSInMemoryJobRepository';
import { CNSJobQueue } from '../runtime/CNSJobQueue';
import { CNSJobUnstorableOutcomeError } from '../runtime/CNSJobUnstorableOutcomeError';
import { CNSJobWorker } from '../runtime/CNSJobWorker';
import type { TCNSJobEvent } from '../types/TCNSJobEvent';
import type { TCNSJobHandler } from '../types/TCNSJobHandler';
import type { TCNSJobHistoryState } from '../types/TCNSJobHistoryState';
import type { TCNSJobRunContext } from '../types/TCNSJobRunContext';
import type { TCNSJobState } from '../types/TCNSJobState';
import type { TCNSJobTypeDefinition } from '../types/TCNSJobTypeDefinition';
import type { TCNSJobWorkerOptions } from '../types/TCNSJobWorkerOptions';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() > deadline) throw new Error('condition not met in time');
        await sleep(2);
    }
};

const deferred = () => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
};

const handler = (
    definition: Partial<TCNSJobTypeDefinition> & { jobType?: string },
    run: (payload: unknown, context: TCNSJobRunContext) => unknown
): TCNSJobHandler => ({ definition: { jobType: 'mail', ...definition }, run });

const closeAttempt = (repository: ICNSJobRepository, context: TCNSJobRunContext | undefined) =>
    repository.finish(
        context
            ? [
                  {
                      jobId: context.jobState.jobId,
                      seq: context.jobState.seq,
                      attemptNumber: context.attempt.attemptNumber,
                      kind: 'final',
                      attemptStatus: 'failed',
                      finalStatus: 'failed',
                  },
              ]
            : []
    );

describe('CNSJobWorker', () => {
    const workers: CNSJobWorker[] = [];

    afterEach(async () => {
        await Promise.all(workers.splice(0).map(worker => worker.stop()));
    });

    const setup = (handlers: TCNSJobHandler[], options: Partial<TCNSJobWorkerOptions> = {}, repository?: ICNSJobRepository) => {
        const jobs = repository ?? new CNSInMemoryJobRepository();
        const logRepository = jobs.logRepository;
        const errors: unknown[] = [];
        const worker = new CNSJobWorker({
            repository: jobs,
            handlers,
            leaseMs: 300,
            pollIntervalMs: 10,
            promoteIntervalMs: 5,
            maintenanceIntervalMs: 50,
            finishBatchMs: 1,
            stopTimeoutMs: 200,
            onError: error => errors.push(error),
            ...options,
        });
        workers.push(worker);
        const queue = new CNSJobQueue({ repository: jobs, events: worker.events });
        const events: TCNSJobEvent[] = [];
        worker.events.on('*', event => events.push(event));
        const finished = async (jobId: string) => {
            const found = await jobs.get(jobId);
            return found !== undefined && 'finalStatus' in found ? (found as TCNSJobHistoryState) : undefined;
        };
        const names = (jobId: string) => events.filter(event => event.jobId === jobId).map(event => event.name);
        return { repository: jobs, logRepository, worker, queue, events, errors, finished, names };
    };

    const enqueue = async (queue: CNSJobQueue, payload: unknown = null, jobId?: string) =>
        (await queue.enqueue({ jobType: 'mail', payload, jobId }))?.jobId ?? '';

    it('runs a job, stores the result and emits the attempt and job events in order', async () => {
        const { worker, queue, finished, names } = setup([handler({}, payload => ({ echoed: payload }))]);
        await worker.start();

        const jobId = await enqueue(queue, 'hello');
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect(await finished(jobId)).toMatchObject({ finalStatus: 'completed', state: { echoed: 'hello' } });
        expect(names(jobId)).toEqual(['job.enqueued', 'attempt.started', 'attempt.completed', 'job.completed']);
    });

    it('never runs more than concurrency at once, however many wakeups arrive', async () => {
        let active = 0;
        let peak = 0;
        const { worker, queue, finished } = setup([
            handler({ concurrency: 2 }, async () => {
                active++;
                peak = Math.max(peak, active);
                await sleep(15);
                active--;
            }),
        ]);
        await worker.start();

        const jobIds = await Promise.all(Array.from({ length: 8 }, () => enqueue(queue)));
        await waitFor(async () => (await Promise.all(jobIds.map(finished))).every(Boolean));

        expect(peak).toBe(2);
    });

    it('retries a failure with the backoff, then fails the job when the budget is spent', async () => {
        const startedAt: number[] = [];
        const { worker, queue, finished, names, events } = setup([
            handler({ retry: { maxFailed: 3, backoff: { type: 'fixed', delayMs: 40 } } }, () => {
                startedAt.push(Date.now());
                throw new TypeError('boom');
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        const history = await finished(jobId);
        expect(history?.finalStatus).toBe('failed');
        expect(history?.attempts.map(attempt => [attempt.status, attempt.errorName])).toEqual([
            ['failed', 'TypeError'],
            ['failed', 'TypeError'],
            ['failed', 'TypeError'],
        ]);
        expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(35);
        expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(35);
        expect(names(jobId).filter(name => name === 'job.delayed')).toHaveLength(2);
        expect(names(jobId).slice(-2)).toEqual(['attempt.failed', 'job.failed']);
        expect((events.find(event => event.name === 'attempt.failed')?.error as Error).message).toBe('boom');
    });

    it('fails without retry when the handler names a non-retryable error', async () => {
        const { worker, queue, finished } = setup([
            handler({ retry: { maxFailed: 5, nonRetryable: ['Invalid'] } }, (_, context) => {
                context.fail('Invalid');
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.attempts.map(attempt => attempt.errorName)).toEqual(['Invalid']);
    });

    it('snoozes without spending the failure budget', async () => {
        let runs = 0;
        const { worker, queue, finished, names } = setup([
            handler({}, (_, context) => {
                runs++;
                if (runs < 4) context.snooze(5);
                return 'done';
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.finalStatus).toBe('completed');
        expect(names(jobId).filter(name => name === 'attempt.snoozed')).toHaveLength(3);
    });

    it('fails an attempt that throttles its group when the job has no group', async () => {
        const { worker, queue, finished } = setup([handler({}, (_, context) => context.throttle(10, 'group'))]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.finalStatus).toBe('failed');
    });

    it('fails a timed-out attempt when its handler returns within the lease, keeping the slot and the lock until then', async () => {
        const release = deferred();
        const started: number[] = [];
        let signal: AbortSignal | undefined;
        const { worker, queue, repository, finished } = setup([
            handler({ timeoutMs: 20, concurrency: 2, retry: { maxFailed: 3 } }, async (_, context) => {
                started.push(context.attempt.attemptNumber);
                if (context.attempt.attemptNumber === 1) {
                    signal = context.abortSignal;
                    await release.promise;
                }
                return 'second';
            }),
        ], { leaseMs: 2000 });
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => signal?.aborted === true);
        await sleep(40);

        expect(started).toEqual([1]);
        expect(((await repository.get(jobId)) as TCNSJobState).lockedUntil).toBeDefined();

        release.resolve();
        await waitFor(async () => (await finished(jobId)) !== undefined);
        expect((await finished(jobId))?.attempts.map(attempt => [attempt.status, attempt.errorName])).toEqual([
            ['failed', 'TimeoutError'],
            ['completed', undefined],
        ]);
        expect(started).toEqual([1, 2]);
    });

    it('aborts a running job on cancel and records it as cancelled', async () => {
        let signal: AbortSignal | undefined;
        const { worker, queue, finished, names } = setup([
            handler({}, (_, context) => {
                signal = context.abortSignal;
                return new Promise((_, reject) => context.abortSignal.addEventListener('abort', () => reject(context.abortSignal.reason)));
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => signal !== undefined);
        await queue.cancel([jobId]);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect(signal?.aborted).toBe(true);
        expect((await finished(jobId))?.finalStatus).toBe('cancelled');
        expect(names(jobId)).toContain('attempt.cancelled');
    });

    it('keeps a completed result when cancel arrives after the handler returned', async () => {
        const { worker, queue, repository, finished } = setup([handler({}, () => 'done')], { finishBatchMs: 50 });
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => ((await repository.get(jobId)) as TCNSJobState | undefined)?.attempts.length === 1);
        await sleep(5);
        await queue.cancel([jobId]);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect(await finished(jobId)).toMatchObject({ finalStatus: 'completed', state: 'done' });
    });

    it('emits nothing for an attempt whose outcome the repository fenced off', async () => {
        const release = deferred();
        let attemptNumber = 0;
        let seq = 0;
        const { worker, queue, repository, names } = setup(
            [
                handler({}, async (_, context) => {
                    attemptNumber = context.attempt.attemptNumber;
                    seq = context.jobState.seq;
                    await release.promise;
                    return 'late';
                }),
            ],
            { leaseMs: 30 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => attemptNumber === 1);
        await repository.finish([{ jobId, seq, attemptNumber, kind: 'requeue', attemptStatus: 'aborted', runAfter: Date.now() + 60_000 }]);
        await waitFor(() => names(jobId).includes('attempt.leaseLost'));
        release.resolve();
        await sleep(30);

        expect(names(jobId)).not.toContain('attempt.completed');
        expect(((await repository.get(jobId)) as TCNSJobState).state).toBeUndefined();
    });

    it('recovers a job whose worker died and counts the attempt as stale', async () => {
        const repository = new CNSInMemoryJobRepository();
        const { worker, queue, finished, names } = setup([handler({}, () => 'recovered')], {}, repository);
        const jobId = await enqueue(queue);
        await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 1 }], 'dead-worker');
        await sleep(5);

        await worker.start();
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.attempts.map(attempt => attempt.status)).toEqual(['stale', 'completed']);
        expect(names(jobId)).toContain('attempt.stale');
    });

    it('writes log lines while the attempt still runs, numbered per attempt', async () => {
        const release = deferred();
        const { worker, queue, logRepository, finished } = setup([
            handler({}, async (_, context) => {
                context.log('log', 'one');
                context.log('log', 'two');
                await release.promise;
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await logRepository.list(jobId)).length === 2);
        expect(await finished(jobId)).toBeUndefined();
        release.resolve();

        expect((await logRepository.list(jobId)).map(entry => [entry.attemptNumber, entry.seq, entry.entry])).toEqual([
            [1, 1, 'one'],
            [1, 2, 'two'],
        ]);
    });

    it('saves state from the open attempt', async () => {
        const { worker, queue, repository, names } = setup([
            handler({ retry: { maxFailed: 2 } }, async (_, context) => {
                expect(await context.saveState({ attempt: context.attempt.attemptNumber })).toBe(true);
                if (context.attempt.attemptNumber === 1) throw new Error('first');
                return context.jobState.state;
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => names(jobId).includes('job.completed'));

        expect(names(jobId).filter(name => name === 'attempt.stateSaved')).toHaveLength(2);
        expect((await repository.get(jobId))?.state).toEqual({ attempt: 1 });
    });

    it('runs middlewares around the handler', async () => {
        const { worker, queue, finished } = setup([handler({}, () => 'raw')], {
            middlewares: [async (context, next) => `${context.jobState.jobType}:${await next()}`],
        });
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.state).toBe('mail:raw');
    });

    it('turns a failed state begin into a failed attempt instead of losing it', async () => {
        const repository = new CNSInMemoryJobRepository();
        repository.stateRepository.begin = async () => {
            throw new Error('state store down');
        };
        let ran = false;
        const { worker, queue, finished } = setup(
            [
                handler({}, () => {
                    ran = true;
                }),
            ],
            {},
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect(ran).toBe(false);
        expect((await finished(jobId))?.finalStatus).toBe('failed');
    });

    it('keeps outcomes of a finish that failed several times and saves them once the repository is back', async () => {
        const repository = new CNSInMemoryJobRepository();
        const finish = repository.finish.bind(repository);
        let failures = 3;
        repository.finish = async (...args) => {
            if (failures-- > 0) throw new Error('finish down');
            return finish(...args);
        };
        const { worker, queue, finished, errors } = setup([handler({}, () => 'ok')], {}, repository);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.state).toBe('ok');
        expect((errors[0] as Error).message).toBe('finish down');
    });

    it('drains running jobs on stop and starts nothing afterwards', async () => {
        const { worker, queue, finished, repository } = setup([
            handler({ concurrency: 1 }, async () => {
                await sleep(30);
                return 'drained';
            }),
        ]);
        await worker.start();

        const first = await enqueue(queue);
        await waitFor(() => worker.runningCount === 1);
        const second = await enqueue(queue);
        await worker.stop();

        expect((await finished(first))?.state).toBe('drained');
        await sleep(30);
        const waiting = (await repository.get(second)) as TCNSJobState;
        expect(waiting.lockedUntil).toBeUndefined();
        expect(waiting.attempts).toEqual([]);
    });

    it('aborts handlers that outlive the stop timeout and returns their jobs to the queue', async () => {
        const { worker, queue, repository } = setup(
            [
                handler({}, (_, context) => new Promise((_, reject) => context.abortSignal.addEventListener('abort', () => reject(context.abortSignal.reason)))),
            ],
            { stopTimeoutMs: 20 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => worker.runningCount === 1);
        await worker.stop();

        const back = (await repository.get(jobId)) as TCNSJobState;
        expect(back.lockedUntil).toBeUndefined();
        expect(back.attempts.map(attempt => attempt.status)).toEqual(['aborted']);
    });

    it('keeps the lock of a handler that ignores abort past stop, so nobody else runs it before the lease ends', async () => {
        const { worker, queue, repository } = setup([handler({}, () => new Promise(() => undefined))], { stopTimeoutMs: 15 });
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => worker.runningCount === 1);
        await worker.stop();

        const kept = (await repository.get(jobId)) as TCNSJobState;
        expect(kept.lockedUntil).toBeDefined();
        expect(kept.attempts.map(attempt => attempt.completedAt)).toEqual([undefined]);
        expect(worker.runningCount).toBe(0);
    });

    it('drops log lines and state from a handler abandoned on stop', async () => {
        let context: TCNSJobRunContext | undefined;
        const { worker, queue, logRepository } = setup(
            [
                handler({}, (_, reached) => {
                    context = reached;
                    return new Promise(() => undefined);
                }),
            ],
            { stopTimeoutMs: 15 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => context !== undefined);
        await worker.stop();
        context?.log('log', 'late');

        expect(await context?.saveState('late')).toBe(false);
        await sleep(20);
        expect(await logRepository.list(jobId)).toEqual([]);
    });

    it('reports a lost lease once for a cancelled handler that ignores abort', async () => {
        let signal: AbortSignal | undefined;
        let captured: TCNSJobRunContext | undefined;
        const { worker, queue, repository, names } = setup(
            [
                handler({}, (_, context) => {
                    signal = context.abortSignal;
                    captured = context;
                    return new Promise(() => undefined);
                }),
            ],
            { leaseMs: 30, stopTimeoutMs: 15 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => signal !== undefined);
        await queue.cancel([jobId]);
        await waitFor(() => signal?.aborted === true);
        await closeAttempt(repository, captured);
        await sleep(100);

        expect(names(jobId).filter(name => name === 'attempt.leaseLost')).toEqual(['attempt.leaseLost']);
    });

    it('discards the unflushed log of an attempt once it learns its lease is lost, and writes no more', async () => {
        let context: TCNSJobRunContext | undefined;
        const { worker, queue, repository, logRepository, names } = setup(
            [
                handler({}, (_, reached) => {
                    context = reached;
                    return new Promise(() => undefined);
                }),
            ],
            { leaseMs: 30, stopTimeoutMs: 15, finishBatchMs: 1000, maintenanceIntervalMs: 60_000 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => context !== undefined);
        context?.log('log', 'buffered');
        await closeAttempt(repository, context);
        await waitFor(() => names(jobId).includes('attempt.leaseLost'));
        context?.log('log', 'late');
        await worker.stop();

        expect(await logRepository.list(jobId)).toEqual([]);
    });

    it('stops writing the log and state of a timed-out attempt once its lease has run out', async () => {
        let context: TCNSJobRunContext | undefined;
        const { worker, queue, logRepository } = setup(
            [
                handler({ timeoutMs: 5 }, (_, reached) => {
                    context = reached;
                    reached.log('log', 'early');
                    return new Promise(() => undefined);
                }),
            ],
            { leaseMs: 40, stopTimeoutMs: 15, maintenanceIntervalMs: 60_000 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await logRepository.list(jobId)).length === 1);
        await sleep(60);
        context?.log('log', 'late');

        expect(await context?.saveState('late')).toBe(false);
        await sleep(20);
        expect((await logRepository.list(jobId)).map(entry => entry.entry)).toEqual(['early']);
    });

    it('does not put back the log of an attempt that lost its lease while the append was failing', async () => {
        const repository = new CNSInMemoryJobRepository();
        const gate = deferred();
        const appended: unknown[] = [];
        repository.logRepository.append = async (_, entries) => {
            appended.push(...entries.map(entry => entry.entry));
            await gate.promise;
            throw new Error('append down');
        };
        let context: TCNSJobRunContext | undefined;
        const { worker, queue, names } = setup(
            [
                handler({}, (_, reached) => {
                    context = reached;
                    reached.log('log', 'buffered');
                    return new Promise(() => undefined);
                }),
            ],
            { leaseMs: 30, stopTimeoutMs: 15, maintenanceIntervalMs: 60_000 },
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => appended.length === 1);
        await closeAttempt(repository, context);
        await waitFor(() => names(jobId).includes('attempt.leaseLost'));
        gate.resolve();
        await sleep(30);

        expect(context).toBeDefined();
        expect(appended).toEqual(['buffered']);
    });

    it('saves both outcomes when an unstorable one is in the last flush of stop', async () => {
        let calls = 0;
        const { worker, queue, finished } = setup(
            [
                handler({ concurrency: 2 }, payload => {
                    calls++;
                    return payload === 'bad' ? BigInt(1) : 'ok';
                }),
            ],
            { finishBatchMs: 1000 }
        );
        const good = await enqueue(queue, 'good');
        const bad = await enqueue(queue, 'bad');
        await worker.start();

        await waitFor(() => calls === 2 && worker.runningCount === 0);
        await worker.stop();

        expect((await finished(good))?.state).toBe('ok');
        expect((await finished(bad))?.finalStatus).toBe('failed');
    });

    it('does not replace an outcome twice when the repository rejects its replacement too', async () => {
        const repository = new CNSInMemoryJobRepository();
        let finishCalls = 0;
        repository.finish = async outcomes => {
            finishCalls++;
            throw new CNSJobUnstorableOutcomeError(outcomes[0], new Error('always'));
        };
        const { worker, queue } = setup([handler({}, () => 'ok')], { pollIntervalMs: 50, stopTimeoutMs: 15 }, repository);
        await worker.start();

        await enqueue(queue);
        await waitFor(() => finishCalls > 0);
        await sleep(120);

        expect(finishCalls).toBeLessThan(8);
    });

    it('waits for a maintenance pass already running before it stops', async () => {
        const repository = new CNSInMemoryJobRepository();
        const maintain = repository.maintain.bind(repository);
        const entered = deferred();
        const gate = deferred();
        repository.maintain = async (...args) => {
            entered.resolve();
            await gate.promise;
            return maintain(...args);
        };
        const { worker } = setup([handler({}, () => 'ok')], { maintenanceIntervalMs: 10 }, repository);
        await worker.start();
        await entered.promise;

        let stopped = false;
        const stopping = worker.stop().then(() => {
            stopped = true;
        });
        await sleep(30);
        expect(stopped).toBe(false);
        gate.resolve();
        await stopping;

        expect(stopped).toBe(true);
    });

    it('saves the log lines of a finished attempt before its outcome, retrying a failed append', async () => {
        const repository = new CNSInMemoryJobRepository();
        let failures = 1;
        const append = repository.logRepository.append.bind(repository.logRepository);
        repository.logRepository.append = async (jobId, entries) => {
            if (failures-- > 0) throw new Error('append down');
            return append(jobId, entries);
        };
        const { worker, queue, finished } = setup(
            [
                handler({}, (_, context) => {
                    context.log('log', 'line');
                    return 'ok';
                }),
            ],
            { pollIntervalMs: 20 },
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await repository.logRepository.list(jobId)).map(entry => entry.entry)).toEqual(['line']);
    });

    it('drops the buffered log once the remaining lease falls inside the margin and saves its outcome', async () => {
        const repository = new CNSInMemoryJobRepository();
        const append = repository.logRepository.append.bind(repository.logRepository);
        let healthy = false;
        repository.logRepository.append = async (jobId, entries) => {
            if (!healthy) throw new Error('append down');
            return append(jobId, entries);
        };
        const { worker, queue, finished } = setup(
            [
                handler({}, (_, context) => {
                    context.log('log', 'line');
                    return 'ok';
                }),
            ],
            { leaseMs: 40, pollIntervalMs: 10 },
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);
        healthy = true;
        await sleep(40);

        expect((await finished(jobId))?.state).toBe('ok');
        expect(await repository.logRepository.list(jobId)).toEqual([]);
    });

    it('refuses a log entry without a JSON form at the call and keeps the other lines', async () => {
        let refused: unknown;
        const { worker, queue, logRepository, finished } = setup([
            handler({}, (_, context) => {
                context.log('log', 'good');
                try {
                    context.log('log', BigInt(1));
                } catch (error) {
                    refused = error;
                }
                return 'ok';
            }),
        ]);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect(refused).toBeInstanceOf(TypeError);
        expect((await logRepository.list(jobId)).map(entry => entry.entry)).toEqual(['good']);
    });

    it('sends a held outcome while its lease still runs, so another worker cannot take it as stale', async () => {
        const repository = new CNSInMemoryJobRepository();
        repository.logRepository.append = async () => {
            throw new Error('append down');
        };
        let ran = false;
        const { worker, queue, finished } = setup(
            [
                handler({}, (_, context) => {
                    ran = true;
                    context.log('log', 'line');
                    return 'ok';
                }),
            ],
            { leaseMs: 300, pollIntervalMs: 60 },
            repository
        );
        const other = setup([handler({}, () => 'other')], { leaseMs: 300, maintenanceIntervalMs: 5 }, repository);
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => ran);
        await other.worker.start();
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.attempts.map(attempt => attempt.status)).toEqual(['completed']);
        expect((await finished(jobId))?.state).toBe('ok');
    });

    it('measures an attempt up to the end of its handler, not up to the saved outcome', async () => {
        const repository = new CNSInMemoryJobRepository();
        const finish = repository.finish.bind(repository);
        let failures = 1;
        repository.finish = async (...args) => {
            if (failures-- > 0) throw new Error('finish down');
            return finish(...args);
        };
        const { worker, queue, events } = setup(
            [
                handler({}, async () => {
                    await sleep(20);
                    return 'ok';
                }),
            ],
            { pollIntervalMs: 150, maintenanceIntervalMs: 60_000 },
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(() => events.some(event => event.jobId === jobId && event.name === 'attempt.completed'));

        const durationMs = events.find(event => event.jobId === jobId && event.name === 'attempt.completed')?.durationMs ?? 0;
        expect(durationMs).toBeGreaterThanOrEqual(15);
        expect(durationMs).toBeLessThan(120);
    });

    it('retries at the poll interval when the repository names an outcome that is not in the batch', async () => {
        const repository = new CNSInMemoryJobRepository();
        let finishCalls = 0;
        repository.finish = async outcomes => {
            finishCalls++;
            throw new CNSJobUnstorableOutcomeError({ ...outcomes[0], seq: -1 }, new Error('elsewhere'));
        };
        const { worker, queue } = setup([handler({}, () => 'ok')], { pollIntervalMs: 50 }, repository);
        await worker.start();

        await enqueue(queue);
        await waitFor(() => finishCalls > 0);
        await sleep(120);

        expect(finishCalls).toBeLessThan(8);
    });

    it('saves the other outcomes of a batch when one outcome cannot be stored', async () => {
        const { worker, queue, finished, errors, names } = setup(
            [handler({ concurrency: 2 }, payload => (payload === 'bad' ? BigInt(1) : 'ok'))],
            { finishBatchMs: 100 }
        );
        const good = await enqueue(queue, 'good');
        const bad = await enqueue(queue, 'bad');
        await worker.start();

        await waitFor(async () => (await finished(good)) !== undefined && (await finished(bad)) !== undefined);

        expect((await finished(good))?.state).toBe('ok');
        expect(names(good)).toContain('job.completed');
        expect((await finished(bad))?.attempts.map(attempt => [attempt.status, attempt.errorName])).toEqual([['failed', 'UnstorableOutcomeError']]);
        expect(names(bad)).toEqual(expect.arrayContaining(['attempt.failed', 'job.failed']));
        expect(errors.length).toBeGreaterThan(0);
    });

    it('keeps the attempt of a job that reused an id while the earlier job still runs in the same worker', async () => {
        const repository = new CNSInMemoryJobRepository();
        const renew = repository.renew.bind(repository);
        let calls = 0;
        let zombie: TCNSJobRunContext | undefined;
        repository.renew = async leases => (calls < 2 ? { lostLeases: [], cancelRequests: [] } : renew(leases));
        const { worker, queue, finished, events } = setup(
            [
                handler({ concurrency: 2 }, async (_, context) => {
                    calls++;
                    zombie ??= context;
                    if (calls === 1) return new Promise(() => undefined);
                    await sleep(60);
                    return 'ok';
                }),
            ],
            { leaseMs: 30, stopTimeoutMs: 15 },
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue, null, 'reused');
        await waitFor(() => calls === 1);
        await closeAttempt(repository, zombie);
        await repository.remove([jobId]);
        await enqueue(queue, null, 'reused');
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.attempts.map(attempt => attempt.status)).toEqual(['completed']);
        expect(events.filter(event => event.name === 'attempt.leaseLost').map(event => event.seq)).toEqual([zombie?.jobState.seq]);
        expect(events.find(event => event.name === 'job.completed')?.seq).not.toBe(zombie?.jobState.seq);
    });

    it('stops writing the log of an attempt whose lease ran out because renewing kept failing', async () => {
        const repository = new CNSInMemoryJobRepository();
        repository.renew = async () => {
            throw new Error('renew down');
        };
        let context: TCNSJobRunContext | undefined;
        const { worker, queue, logRepository } = setup(
            [
                handler({}, (_, reached) => {
                    context = reached;
                    reached.log('log', 'early');
                    return new Promise(() => undefined);
                }),
            ],
            { leaseMs: 40, stopTimeoutMs: 15, maintenanceIntervalMs: 60_000 },
            repository
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await logRepository.list(jobId)).length === 1);
        await sleep(60);
        context?.log('log', 'late');

        expect(await context?.saveState('late')).toBe(false);
        await sleep(20);
        expect((await logRepository.list(jobId)).map(entry => entry.entry)).toEqual(['early']);
    });

    it('fails a hung timed-out attempt as a timeout once its lease runs out', async () => {
        const { worker, queue, finished } = setup(
            [handler({ timeoutMs: 10, retry: { maxFailed: 1, maxStale: 5 } }, () => new Promise(() => undefined))],
            { leaseMs: 30, maintenanceIntervalMs: 20 }
        );
        await worker.start();

        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.attempts.map(attempt => [attempt.status, attempt.errorName])).toEqual([['failed', 'TimeoutError']]);
    });

    it('reports outcomes it could not save on stop instead of throwing', async () => {
        const repository = new CNSInMemoryJobRepository();
        repository.finish = async () => {
            throw new Error('finish down');
        };
        const { worker, queue, errors } = setup([handler({}, () => 'ok')], {}, repository);
        await worker.start();

        await enqueue(queue);
        await waitFor(() => errors.length > 0);
        await expect(worker.stop()).resolves.toBeUndefined();

        expect((errors[errors.length - 1] as Error).message).toMatch('were not saved');
    });

    it('leaves the worker restartable when start fails', async () => {
        const repository = new CNSInMemoryJobRepository();
        const registerTypes = repository.registerTypes.bind(repository);
        let failures = 1;
        repository.registerTypes = async registrations => {
            if (failures-- > 0) throw new Error('register down');
            return registerTypes(registrations);
        };
        const { worker, queue, finished } = setup([handler({}, () => 'ok')], {}, repository);

        await expect(worker.start()).rejects.toThrow('register down');
        await worker.start();
        const jobId = await enqueue(queue);
        await waitFor(async () => (await finished(jobId)) !== undefined);

        expect((await finished(jobId))?.state).toBe('ok');
    });

    it('publishes the payload schema and description of a type to its meta, replacing what an earlier definition published', async () => {
        const payloadSchema = { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] };
        const repository = new CNSInMemoryJobRepository();
        await (await repository.registerTypes([{ jobType: 'sms', meta: { payloadSchema: { type: 'string' } } }]))();
        const { worker } = setup(
            [handler({ payloadSchema, description: 'sends mail' }, () => undefined), handler({ jobType: 'sms' }, () => undefined)],
            {},
            repository
        );

        await worker.start();
        const types = await repository.listTypes();
        await worker.stop();

        expect(types.find(type => type.jobType === 'mail')?.meta).toEqual({ payloadSchema, description: 'sends mail' });
        expect(types.find(type => type.jobType === 'sms')?.meta).toEqual({});
    });

    it('enqueues schedule slots ahead under stable job ids and runs them on time', async () => {
        const ran: string[] = [];
        const { worker, repository } = setup([
            handler({ schedules: [{ scheduleId: 'tick', everyMs: 40, startAt: 0 }] }, (_, context) => {
                ran.push(context.jobState.jobId);
            }),
        ]);
        await worker.start();

        await waitFor(() => ran.length >= 2);

        expect(ran[0]).toMatch(/^cron:tick:\d+$/);
        expect(Number(ran[0].split(':')[2]) % 40).toBe(0);
        expect((await repository.listSchedules(['mail'])).map(schedule => [schedule.scheduleId, schedule.fromDefinition])).toEqual([
            ['tick', true],
        ]);
    });

    it('enqueues the slots it missed on the next tick when the first schedule enqueue fails', async () => {
        const repository = new CNSInMemoryJobRepository();
        const enqueueJobs = repository.enqueue.bind(repository);
        let failures = 1;
        repository.enqueue = async (requests, options) => {
            if (failures-- > 0) throw new Error('enqueue down');
            return enqueueJobs(requests, options);
        };
        const startedAt = Date.now();
        const { worker, events } = setup(
            [handler({ schedules: [{ scheduleId: 'tick', everyMs: 1000, startAt: 0 }] }, () => undefined)],
            { scheduleCatchUpMs: 3000 },
            repository
        );
        await worker.start();

        await waitFor(() => events.some(event => event.name === 'job.enqueued'));

        const slots = events.filter(event => event.name === 'job.enqueued').map(event => Number(event.jobId?.split(':')[2]));
        expect(Math.min(...slots)).toBeLessThan(startedAt - 1000);
    });

    it('keeps enqueuing valid schedules when another schedule of the type is malformed', async () => {
        const repository = new CNSInMemoryJobRepository();
        await repository.upsertSchedules('mail', [{ scheduleId: 'broken', everyMs: 0 }], false);
        const ran: string[] = [];
        const { worker, errors } = setup(
            [
                handler({ schedules: [{ scheduleId: 'tick', everyMs: 40, startAt: 0 }] }, (_, context) => {
                    ran.push(context.jobState.jobId);
                }),
            ],
            {},
            repository
        );
        await worker.start();

        await waitFor(() => ran.length >= 1);

        expect(errors.length).toBeGreaterThan(0);
    });

    it('emits the jobs a schedule slot enqueue superseded', async () => {
        const repository = new CNSInMemoryJobRepository();
        const enqueueJobs = repository.enqueue.bind(repository);
        repository.enqueue = async requests => {
            const results = await enqueueJobs(requests);
            results[0].transitions = [{ jobId: 'head', seq: 1, jobType: 'mail', attemptNumber: 1, finalStatus: 'superseded' }];
            return results;
        };
        const { worker, events } = setup([handler({ schedules: [{ scheduleId: 'tick', everyMs: 40, startAt: 0 }] }, () => undefined)], {}, repository);
        await worker.start();

        await waitFor(() => events.some(event => event.name === 'job.superseded'));

        expect(events.find(event => event.name === 'job.superseded')).toMatchObject({ jobId: 'head', jobType: 'mail', seq: 1 });
    });

    it('removes definition schedules that the definition no longer declares, keeping manual ones', async () => {
        const repository = new CNSInMemoryJobRepository();
        await repository.upsertSchedules('mail', [{ scheduleId: 'old', everyMs: 1000 }], true);
        await repository.upsertSchedules('mail', [{ scheduleId: 'manual', everyMs: 1000 }], false);
        const { worker } = setup([handler({}, () => undefined)], {}, repository);

        await worker.start();

        expect((await repository.listSchedules(['mail'])).map(schedule => schedule.scheduleId)).toEqual(['manual']);
    });

    it('protects finished rows inside the dedup window of each type, schedule catch-up included, from retention', async () => {
        const repository = new CNSInMemoryJobRepository();
        const windows: Array<Readonly<Record<string, number>>> = [];
        const maintain = repository.maintain.bind(repository);
        repository.maintain = async (retention, dedupWindowMs, horizonMs) => {
            windows.push(dedupWindowMs);
            return maintain(retention, dedupWindowMs, horizonMs);
        };
        const { worker } = setup(
            [
                handler({ idempotencyWindowMs: 10, schedules: [{ scheduleId: 'tick', everyMs: 60_000 }] }, () => undefined),
                handler({ jobType: 'sms', uniqueWindowMs: 30 }, () => undefined),
                handler({ jobType: 'push' }, () => undefined),
            ],
            { scheduleCatchUpMs: 1000, maintenanceIntervalMs: 20 },
            repository
        );
        await worker.start();

        await waitFor(() => windows.length > 0);

        expect(windows[0]).toEqual({ mail: 1020, sms: 30 });
    });

    it('refuses two handlers for one job type', () => {
        expect(() => setup([handler({}, () => undefined), handler({}, () => undefined)])).toThrow('two handlers');
    });
});
