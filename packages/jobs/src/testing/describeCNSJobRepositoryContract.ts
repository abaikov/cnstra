import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import { CNSJobUnstorableOutcomeError } from '../runtime/CNSJobUnstorableOutcomeError';
import type { ECNSJobKeyMode } from '../types/ECNSJobKeyMode';
import type { TCNSJob } from '../types/TCNSJob';
import type { TCNSJobAttemptOutcome } from '../types/TCNSJobAttemptOutcome';
import type { TCNSJobClaimRequest } from '../types/TCNSJobClaimRequest';
import type { TCNSJobEnqueueRequest } from '../types/TCNSJobEnqueueRequest';
import type { TCNSJobHistoryState } from '../types/TCNSJobHistoryState';
import type { TCNSJobLease } from '../types/TCNSJobLease';
import type { TCNSJobRepositoryContractFactory } from '../types/TCNSJobRepositoryContractFactory';
import type { TCNSJobState } from '../types/TCNSJobState';

const START = 1_700_000_000_000;
const LEASE_MS = 10_000;
const WORKER = 'worker-1';

export function describeCNSJobRepositoryContract(name: string, factory: TCNSJobRepositoryContractFactory): void {
    describe(`${name} — ICNSJobRepository contract`, () => {
        let time = START;
        let repository: ICNSJobRepository;

        const advance = (ms: number) => {
            time += ms;
        };

        const job = (overrides: Partial<TCNSJob> = {}): TCNSJob => ({ jobType: 'mail', payload: { n: 1 }, ...overrides });

        const enqueue = async (overrides: Partial<TCNSJob> = {}, request: Omit<TCNSJobEnqueueRequest, 'job'> = {}) => {
            const [result] = await repository.enqueue([{ job: job(overrides), ...request }]);
            return result;
        };

        const keyed = (jobKey: string, keyMode: ECNSJobKeyMode, overrides: Partial<TCNSJob> = {}, extra = {}) =>
            enqueue({ jobKey, ...overrides }, { keyMode, ...extra });

        const claim = async (request: Partial<TCNSJobClaimRequest> = {}) => {
            const result = await repository.claim([{ jobType: 'mail', free: 10, leaseMs: LEASE_MS, ...request }], WORKER);
            return result.claimed;
        };

        const claimIds = async (request: Partial<TCNSJobClaimRequest> = {}) => (await claim(request)).map(found => found.jobId);

        const lastAttempt = (jobState: TCNSJobState) => jobState.attempts[jobState.attempts.length - 1].attemptNumber;

        const lease = (jobState: TCNSJobState, attemptNumber = lastAttempt(jobState)): TCNSJobLease => ({
            jobId: jobState.jobId,
            seq: jobState.seq,
            attemptNumber,
            leaseMs: LEASE_MS,
        });

        const complete = (jobState: TCNSJobState, result?: unknown): TCNSJobAttemptOutcome => ({
            jobId: jobState.jobId,
            seq: jobState.seq,
            attemptNumber: lastAttempt(jobState),
            kind: 'completed',
            result,
        });

        const requeue = (
            jobState: TCNSJobState,
            runAfter = time,
            attemptStatus: 'failed' | 'stale' | 'aborted' | 'snoozed' = 'failed'
        ): TCNSJobAttemptOutcome => ({
            jobId: jobState.jobId,
            seq: jobState.seq,
            attemptNumber: lastAttempt(jobState),
            kind: 'requeue',
            attemptStatus,
            runAfter,
        });

        const fail = (jobState: TCNSJobState): TCNSJobAttemptOutcome => ({
            jobId: jobState.jobId,
            seq: jobState.seq,
            attemptNumber: lastAttempt(jobState),
            kind: 'final',
            attemptStatus: 'failed',
            finalStatus: 'failed',
        });

        const delivered = async (assertion: () => void) => {
            const deadline = Date.now() + 2000;
            for (;;) {
                try {
                    assertion();
                    await new Promise(resolve => setTimeout(resolve, 50));
                    assertion();
                    return;
                } catch (error) {
                    if (Date.now() > deadline) throw error;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        };

        const withHistory = (test: () => Promise<void>) => async () => {
            if (repository.capabilities.history) await test();
        };

        const history = async (jobId: string) => (await repository.get(jobId)) as TCNSJobHistoryState | undefined;

        beforeEach(async () => {
            time = START;
            repository = await factory.create(() => time);
        });

        afterEach(async () => {
            await factory.destroy?.(repository);
        });

        describe('enqueue and claim', () => {
            it('claims an enqueued job with a new open attempt and a lease', async () => {
                const { jobId, status } = await enqueue();

                const [claimed] = await claim();

                expect(status).toBe('inserted');
                expect(claimed.jobId).toBe(jobId);
                expect(claimed.payload).toEqual({ n: 1 });
                expect(claimed.lockedUntil).toBe(START + LEASE_MS);
                expect(claimed.attempts).toHaveLength(1);
                expect(claimed.attempts[0]).toMatchObject({ attemptNumber: 1, startedAt: START });
                expect(claimed.attempts[0].completedAt).toBeUndefined();
                expect(await claimIds()).toEqual([]);
            });

            it('returns batch results in request order and ignores other job types', async () => {
                const results = await repository.enqueue([
                    { job: job({ jobId: 'a' }) },
                    { job: job({ jobId: 'b', jobType: 'sms' }) },
                    { job: job({ jobId: 'a' }) },
                ]);

                expect(results.map(result => [result.jobId, result.status])).toEqual([
                    ['a', 'inserted'],
                    ['b', 'inserted'],
                    ['a', 'deduplicated'],
                ]);
                expect(await claimIds()).toEqual(['a']);
            });

            it('orders by priority, then runAfter, then enqueue order', async () => {
                await enqueue({ jobId: 'late', runAfter: START - 1 });
                await enqueue({ jobId: 'low', priority: -1, runAfter: START - 100 });
                await enqueue({ jobId: 'high', priority: 5 });
                await enqueue({ jobId: 'early', runAfter: START - 2 });
                await enqueue({ jobId: 'second-at-same-time', runAfter: START - 2 });

                expect(await claimIds()).toEqual(['high', 'early', 'second-at-same-time', 'late', 'low']);
            });

            it('limits a claim to free slots and to maxRunning across claims', async () => {
                for (let index = 0; index < 5; index++) await enqueue();

                expect(await claimIds({ free: 2 })).toHaveLength(2);
                expect(await claimIds({ free: 5, maxRunning: 3 })).toHaveLength(1);
            });

            it('never hands the same job or more than maxRunning to concurrent claims', async () => {
                for (let index = 0; index < 3; index++) await enqueue();

                const claims = await Promise.all(
                    Array.from({ length: 4 }, () => claimIds({ free: 3, maxRunning: 2 }))
                );
                const claimed = claims.flat();

                expect(claimed).toHaveLength(2);
                expect(new Set(claimed).size).toBe(2);
            });

            it('keeps a job with a future runAfter out of claims until promoted', async () => {
                const { jobId } = await enqueue({ runAfter: START + 1000 });

                expect(await claimIds()).toEqual([]);
                advance(1000);
                const promoted = await repository.promote(['mail']);

                expect(promoted.readyJobIds).toEqual([jobId]);
                expect(await claimIds()).toEqual([jobId]);
            });

            it('rejects a transactional enqueue when the repository cannot do one', async () => {
                if (repository.capabilities.transactionalEnqueue) return;

                await expect(repository.enqueue([{ job: job() }], { transaction: {} })).rejects.toThrow();
            });

            it('notifies ready once per type for a batch and not for delayed jobs', async () => {
                const ready: string[] = [];
                await repository.subscribe({ ready: jobType => ready.push(jobType) });

                await repository.enqueue([{ job: job() }, { job: job() }, { job: job({ jobType: 'sms', runAfter: START + 10 }) }]);

                if (repository.capabilities.pushWakeups) await delivered(() => expect(ready).toEqual(['mail']));
            });
        });

        describe('idempotency by jobId', () => {
            it('deduplicates against a live job and against history inside the window only', withHistory(async () => {
                await enqueue({ jobId: 'once' });
                expect((await enqueue({ jobId: 'once' })).status).toBe('deduplicated');

                const [claimed] = await claim();
                await repository.finish([complete(claimed)]);
                advance(500);

                expect((await enqueue({ jobId: 'once' }, { idempotencyWindowMs: 1000 })).status).toBe('deduplicated');
                advance(501);
                expect((await enqueue({ jobId: 'once' }, { idempotencyWindowMs: 1000 })).status).toBe('inserted');
            }));

            it('deduplicates against all history when no window is given', withHistory(async () => {
                await enqueue({ jobId: 'once' });
                const [claimed] = await claim();
                await repository.finish([complete(claimed)]);
                advance(1_000_000);

                expect((await enqueue({ jobId: 'once' })).status).toBe('deduplicated');
            }));
        });

        describe('finish', () => {
            it('moves a completed job to history with its result as state and notifies done', withHistory(async () => {
                const done: string[] = [];
                await repository.subscribe({ done: jobId => done.push(jobId) });
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                advance(5);

                const { transitions } = await repository.finish([complete(claimed, { sent: true })]);
                const finished = await history(jobId);

                expect(transitions).toEqual([{ jobId, seq: expect.any(Number), jobType: 'mail', attemptNumber: 1, finalStatus: 'completed' }]);
                expect(finished).toMatchObject({ finalStatus: 'completed', finishedAt: START + 5, state: { sent: true } });
                expect(finished?.attempts[0]).toMatchObject({ status: 'completed', completedAt: START + 5 });
                expect(await repository.stateRepository.load(jobId)).toEqual({ sent: true });
                if (repository.capabilities.pushWakeups) await delivered(() => expect(done).toEqual([jobId]));
            }));

            it('requeues a failed attempt to run again after runAfter', async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();

                const { transitions } = await repository.finish([{ ...requeue(claimed, START + 100), errorName: 'Boom' }]);

                expect(transitions).toEqual([{ jobId, seq: expect.any(Number), jobType: 'mail', attemptNumber: 1 }]);
                expect(await claimIds()).toEqual([]);
                advance(100);
                await repository.promote(['mail']);
                const [again] = await claim();
                expect(again.attempts.map(attempt => [attempt.attemptNumber, attempt.status, attempt.errorName])).toEqual([
                    [1, 'failed', 'Boom'],
                    [2, undefined, undefined],
                ]);
            });

            it('merges attempt meta into the finished attempt', withHistory(async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();

                await repository.finish([{ ...complete(claimed), attemptMeta: { sentryId: 'e1' } }]);

                expect((await history(jobId))?.attempts[0].meta).toMatchObject({ sentryId: 'e1' });
            }));

            it('stores attempt meta of a requeued attempt as JSON, dropping nested functions', async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();

                const { transitions } = await repository.finish([{ ...requeue(claimed), attemptMeta: { trace: { id: 'e1', cb: () => 1 } } }]);

                expect(transitions).toHaveLength(1);
                expect(((await repository.get(jobId)) as TCNSJobState).attempts[0].meta).toMatchObject({ trace: { id: 'e1' } });
            });

            it('claims new jobs for the freed slots in the same call', async () => {
                await enqueue({ jobId: 'first' });
                await enqueue({ jobId: 'second' });
                const [claimed] = await claim({ free: 1 });

                const result = await repository.finish([complete(claimed)], {
                    requests: [{ jobType: 'mail', free: 1, leaseMs: LEASE_MS }],
                    workerId: WORKER,
                });

                expect(result.claimed.map(found => found.jobId)).toEqual(['second']);
                expect(result.transitions[0]).toMatchObject({ jobId: 'first', finalStatus: 'completed' });
            });

            it('ignores an outcome for an attempt that is not the open one', async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                await repository.finish([requeue(claimed)]);
                const [again] = await claim();

                const { transitions } = await repository.finish([complete(claimed)]);

                expect(transitions).toEqual([]);
                expect(lastAttempt(again)).toBe(2);
                expect((await repository.get(jobId)) as TCNSJobState).toMatchObject({ lockedUntil: START + LEASE_MS });
            });
        });

        describe('leases and stale attempts', () => {
            it('renews an open attempt and reports a lost one', async () => {
                await enqueue({ jobId: 'kept' });
                const [claimed] = await claim();
                advance(1000);

                const result = await repository.renew([
                    lease(claimed),
                    lease(claimed, 99),
                    { jobId: 'missing', seq: claimed.seq, attemptNumber: 1, leaseMs: LEASE_MS },
                ]);

                expect(result.lostLeases.map(lost => [lost.jobId, lost.attemptNumber])).toEqual([
                    ['kept', 99],
                    ['missing', 1],
                ]);
                expect(((await repository.get('kept')) as TCNSJobState).lockedUntil).toBe(START + 1000 + LEASE_MS);
            });

            it('hands out expired leases and fences the zombie attempt', async () => {
                const { jobId } = await enqueue();
                const [zombie] = await claim();
                expect(await repository.takeStale(['mail'])).toEqual([]);
                advance(LEASE_MS + 1);

                const [stale] = await repository.takeStale(['mail']);
                await repository.finish([requeue(stale, time, 'stale')]);
                const [current] = await claim();

                expect(lastAttempt(current)).toBe(2);
                expect(await repository.stateRepository.save(jobId, zombie.seq, lastAttempt(zombie), 'zombie')).toBe(false);
                expect((await repository.finish([complete(zombie)])).transitions).toEqual([]);
                expect(await repository.stateRepository.save(jobId, current.seq, 2, 'current')).toBe(true);
                expect((await repository.renew([lease(zombie)])).lostLeases).toEqual([lease(zombie)]);
            });

            it('fences every attempt of an earlier job under a reused id from the new one', async () => {
                await enqueue({ jobId: 'reused' });
                const [zombie] = await claim();
                advance(LEASE_MS + 1);
                const [stale] = await repository.takeStale(['mail']);
                await repository.finish([
                    { jobId: stale.jobId, seq: stale.seq, attemptNumber: lastAttempt(stale), kind: 'final', attemptStatus: 'stale', finalStatus: 'failed' },
                ]);
                advance(1);
                await enqueue({ jobId: 'reused' }, { idempotencyWindowMs: 0 });
                const [current] = await claim();

                expect(lastAttempt(current)).toBe(lastAttempt(zombie));
                expect((await repository.renew([lease(zombie), lease(current)])).lostLeases).toEqual([lease(zombie)]);
                expect(await repository.stateRepository.save('reused', zombie.seq, lastAttempt(zombie), 'zombie')).toBe(false);
                expect((await repository.finish([complete(zombie, 'zombie')])).transitions).toEqual([]);
                expect(await repository.stateRepository.save('reused', current.seq, lastAttempt(current), 'current')).toBe(true);
                expect(await repository.stateRepository.load('reused')).toBe('current');
            });

            it('rejects a batch with an outcome it cannot store as a whole and names that outcome', async () => {
                await enqueue({ jobId: 'good' });
                await enqueue({ jobId: 'bad' });
                const [good, bad] = await claim();
                const unstorable = complete(bad, () => undefined);

                const rejected = await repository.finish([complete(good, 'ok'), unstorable]).catch((error: unknown) => error);

                expect(rejected).toBeInstanceOf(CNSJobUnstorableOutcomeError);
                expect((rejected as CNSJobUnstorableOutcomeError).outcome).toEqual(unstorable);
                expect(((await repository.get('good')) as TCNSJobState).lockedUntil).toBeDefined();
                expect((await repository.finish([complete(good, 'ok')])).transitions).toHaveLength(1);
            });

            it('stores an undefined result and rejects results without a JSON representation', async () => {
                await enqueue({ jobId: 'void' });
                await enqueue({ jobId: 'big' });
                const [empty, big] = await claim();

                expect((await repository.finish([complete(empty)])).transitions).toHaveLength(1);
                await expect(repository.finish([complete(big, BigInt(1))])).rejects.toBeInstanceOf(CNSJobUnstorableOutcomeError);
                await expect(repository.finish([{ ...requeue(big), attemptMeta: { n: BigInt(1) } }])).rejects.toBeInstanceOf(
                    CNSJobUnstorableOutcomeError
                );
            });

            it('stores payloads as JSON: dates become strings, nested functions disappear', async () => {
                await enqueue({ jobId: 'json', payload: { when: new Date(0), run: () => 1, n: 1 } });

                expect(((await repository.get('json')) as TCNSJobState).payload).toEqual({ when: '1970-01-01T00:00:00.000Z', n: 1 });
            });

            it('removes a running job only once its lease has run out', async () => {
                const { jobId } = await enqueue();
                await claim();

                expect(await repository.remove([jobId])).toEqual([]);
                advance(LEASE_MS + 1);
                expect(await repository.remove([jobId])).toEqual([jobId]);
            });

            it('rejects payloads and state without a JSON representation and stores nothing', async () => {
                await expect(repository.enqueue([{ job: job({ jobId: 'fine' }) }, { job: job({ jobId: 'big', payload: BigInt(1) }) }])).rejects.toThrow();
                expect(await repository.get('fine')).toBeUndefined();
                await enqueue({ jobId: 'stateful' });
                const [claimed] = await claim();

                await expect(repository.stateRepository.save('stateful', claimed.seq, lastAttempt(claimed), { n: BigInt(1) })).rejects.toThrow();
                await expect(repository.stateRepository.save('stateful', claimed.seq, lastAttempt(claimed), { text: 'a\u0000b' })).rejects.toThrow();
                await expect(repository.finish([complete(claimed, 'a\u0000b')])).rejects.toBeInstanceOf(CNSJobUnstorableOutcomeError);
                expect(await repository.stateRepository.load('stateful')).toBeUndefined();
            });

            it('ignores a stale outcome when the lease was renewed in between', async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                advance(LEASE_MS + 1);
                const [stale] = await repository.takeStale(['mail']);
                await repository.renew([lease(claimed)]);

                const { transitions } = await repository.finish([requeue(stale, time, 'stale')]);

                expect(transitions).toEqual([]);
                expect(((await repository.get(jobId)) as TCNSJobState).lockedUntil).toBe(time + LEASE_MS);
            });
        });

        describe('cancel', () => {
            it('cancels a waiting job at once', withHistory(async () => {
                const { jobId } = await enqueue();

                const result = await repository.cancel([jobId, 'missing']);

                expect(result).toEqual({ cancelled: [jobId], requested: [] });
                expect(await history(jobId)).toMatchObject({ finalStatus: 'cancelled' });
                expect(await claimIds()).toEqual([]);
            }));

            it('requests cancel of a running attempt, notifies it and reports it on renew', async () => {
                const cancels: Array<[string, number, number]> = [];
                await repository.subscribe({ cancel: (jobId, seq, attemptNumber) => cancels.push([jobId, seq, attemptNumber]) });
                const { jobId } = await enqueue();
                const [claimed] = await claim();

                const result = await repository.cancel([jobId]);
                const renewed = await repository.renew([lease(claimed)]);

                expect(result).toEqual({ cancelled: [], requested: [jobId] });
                if (repository.capabilities.pushWakeups) await delivered(() => expect(cancels).toEqual([[jobId, claimed.seq, 1]]));
                expect(renewed.cancelRequests).toEqual([{ lease: lease(claimed), cancelRequest: { at: START, as: 'cancelled' } }]);
                expect(lastAttempt(claimed)).toBe(1);
            });

            it('turns any failing end of a cancel-requested attempt into the requested final status', async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                await repository.cancel([jobId]);

                const { transitions } = await repository.finish([requeue(claimed)]);

                expect(transitions).toEqual([{ jobId, seq: expect.any(Number), jobType: 'mail', attemptNumber: 1, finalStatus: 'cancelled' }]);
                expect(await repository.get(jobId).then(found => found && 'finalStatus' in found ? found.attempts[0].status : 'gone')).toBe(
                    repository.capabilities.history ? 'cancelled' : 'gone'
                );
                expect(await claimIds()).toEqual([]);
            });

            it('still completes a cancel-requested attempt whose work finished', withHistory(async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                await repository.cancel([jobId]);

                await repository.finish([complete(claimed, 'done')]);

                expect(await history(jobId)).toMatchObject({ finalStatus: 'completed', state: 'done' });
            }));

            it('keeps the first cancel request', withHistory(async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                await repository.cancel([jobId], 'superseded');
                advance(10);
                await repository.cancel([jobId], 'cancelled');

                await repository.finish([fail(claimed)]);

                expect(await history(jobId)).toMatchObject({ finalStatus: 'superseded' });
                expect((await history(jobId))?.attempts[0].cancelRequest).toEqual({ at: START, as: 'superseded' });
            }));

            it('cancels a cancel-requested attempt through the stale path', withHistory(async () => {
                const { jobId } = await enqueue();
                await claim();
                await repository.cancel([jobId]);
                advance(LEASE_MS + 1);

                const [stale] = await repository.takeStale(['mail']);
                await repository.finish([requeue(stale, time, 'stale')]);

                expect(await history(jobId)).toMatchObject({ finalStatus: 'cancelled' });
            }));
        });

        describe('job keys', () => {
            it('serial: runs one job per key at a time, in enqueue order', async () => {
                await keyed('user-1', 'serial', { jobId: 'a' });
                await keyed('user-1', 'serial', { jobId: 'b' });
                await keyed('user-2', 'serial', { jobId: 'c' });

                const first = await claim();
                expect(first.map(found => found.jobId)).toEqual(['a', 'c']);
                expect(await claimIds()).toEqual([]);

                await repository.finish([complete(first[0])]);
                expect(await claimIds()).toEqual(['b']);
            });

            it('runs one job per key across job types, while key modes match the same type only', async () => {
                await keyed('user-1', 'serial', { jobId: 'mail-1' });
                await keyed('user-1', 'serial', { jobId: 'sms-1', jobType: 'sms' });
                const leading = await keyed('user-1', 'leading', { jobId: 'push-1', jobType: 'push' });

                const [mail] = await claim();
                expect(mail.jobId).toBe('mail-1');
                expect(leading.status).toBe('inserted');
                expect(await claimIds({ jobType: 'sms' })).toEqual([]);

                await repository.finish([complete(mail)]);
                expect(await claimIds({ jobType: 'sms' })).toEqual(['sms-1']);
            });

            it('serial: a head that is retrying with a delay keeps the key', async () => {
                await keyed('user-1', 'serial', { jobId: 'a' });
                await keyed('user-1', 'serial', { jobId: 'b' });
                const [head] = await claim();

                await repository.finish([requeue(head, START + 100)]);
                expect(await claimIds()).toEqual([]);

                advance(100);
                await repository.promote(['mail']);
                expect(await claimIds()).toEqual(['a']);
            });

            it('leading: drops a duplicate while the key is live or finished inside the window', withHistory(async () => {
                const first = await keyed('user-1', 'leading', { jobId: 'a' }, { uniqueWindowMs: 1000 });
                const duplicate = await keyed('user-1', 'leading', { jobId: 'b' }, { uniqueWindowMs: 1000 });
                expect([first.status, duplicate.status, duplicate.jobId]).toEqual(['inserted', 'deduplicated', 'a']);

                const [claimed] = await claim();
                await repository.finish([complete(claimed)]);
                advance(1000);
                expect((await keyed('user-1', 'leading', { jobId: 'c' }, { uniqueWindowMs: 1000 })).status).toBe('deduplicated');
                advance(1);
                expect((await keyed('user-1', 'leading', { jobId: 'd' }, { uniqueWindowMs: 1000 })).status).toBe('inserted');
            }));

            it('latest: replaces the payload and runAfter of a pending job without attempts', async () => {
                await keyed('user-1', 'latest', { jobId: 'a', payload: { n: 1 }, runAfter: START + 1000 });

                const replaced = await keyed('user-1', 'latest', { jobId: 'b', payload: { n: 2 } });

                expect(replaced).toEqual({ jobId: 'a', status: 'replaced', supersededJobIds: [] });
                const [claimed] = await claim();
                expect([claimed.jobId, claimed.payload]).toEqual(['a', { n: 2 }]);
            });

            it('latest: lets a running job finish and queues the newest behind it', async () => {
                await keyed('user-1', 'latest', { jobId: 'a' });
                const [running] = await claim();

                await keyed('user-1', 'latest', { jobId: 'b' });
                await keyed('user-1', 'latest', { jobId: 'c', payload: { n: 3 } });

                const renewed = await repository.renew([lease(running)]);
                expect(renewed.cancelRequests).toEqual([]);
                expect(await claimIds()).toEqual([]);
                await repository.finish([complete(running)]);
                const [next] = await claim();
                expect([next.jobId, next.payload]).toEqual(['b', { n: 3 }]);
            });

            it('latest: supersedes a waiting head that already has attempts', withHistory(async () => {
                await keyed('user-1', 'latest', { jobId: 'a' });
                const [head] = await claim();
                await repository.finish([requeue(head, START + 100)]);

                const result = await keyed('user-1', 'latest', { jobId: 'b' });

                expect(result).toEqual({ jobId: 'b', status: 'inserted', supersededJobIds: ['a'] });
                expect(await history('a')).toMatchObject({ finalStatus: 'superseded' });
                expect(await claimIds()).toEqual(['b']);
            }));

            it('switch: asks the running job of the key to cancel as superseded', async () => {
                await keyed('user-1', 'switch', { jobId: 'a' });
                const [running] = await claim();

                await keyed('user-1', 'switch', { jobId: 'b' });
                const renewed = await repository.renew([lease(running)]);
                const { transitions } = await repository.finish([fail(running)]);

                expect(renewed.cancelRequests).toEqual([{ lease: lease(running), cancelRequest: { at: START, as: 'superseded' } }]);
                expect(transitions).toEqual([{ jobId: 'a', seq: expect.any(Number), jobType: 'mail', attemptNumber: 1, finalStatus: 'superseded' }]);
                expect(await claimIds()).toEqual(['b']);
            });

            it('debounce: pushes runAfter by the quiet time but not past the max wait', async () => {
                const debounce = { quietMs: 100, maxWaitMs: 250 };
                const first = await keyed('user-1', 'latest', { jobId: 'a' }, { debounce });
                expect(((await repository.get(first.jobId)) as TCNSJobState).runAfter).toBe(START + 100);

                advance(90);
                await keyed('user-1', 'latest', { jobId: 'b' }, { debounce });
                expect(((await repository.get('a')) as TCNSJobState).runAfter).toBe(START + 190);

                advance(90);
                await keyed('user-1', 'latest', { jobId: 'c' }, { debounce });
                expect(((await repository.get('a')) as TCNSJobState).runAfter).toBe(START + 250);
            });

            it('advances the key when a job leaves by cancel or removal', async () => {
                await keyed('user-1', 'serial', { jobId: 'a' });
                await keyed('user-1', 'serial', { jobId: 'b' });
                await keyed('user-1', 'serial', { jobId: 'c' });

                expect((await repository.cancel(['a'])).cancelled).toEqual(['a']);
                expect(await repository.remove(['b'])).toEqual(['b']);
                expect(await claimIds()).toEqual(['c']);
            });

            it('advances the key when its holder expires', async () => {
                await keyed('user-1', 'serial', { jobId: 'a' });
                advance(800);
                await keyed('user-1', 'serial', { jobId: 'b' });
                advance(300);

                const promoted = await repository.promote(['mail'], { mail: 500 });

                expect(promoted.transitions.map(transition => [transition.jobId, transition.finalStatus])).toEqual([['a', 'expired']]);
                expect(promoted.readyJobIds).toEqual(['b']);
                expect(await claimIds()).toEqual(['b']);
            });

            it('lets a runnable job pass an older job of its key that is not due yet', async () => {
                await keyed('user-1', 'serial', { jobId: 'later', runAfter: START + 3_600_000 });
                await keyed('user-1', 'serial', { jobId: 'now' });

                expect(await claimIds()).toEqual(['now']);
            });

            it('retry of a failed keyed job takes a new place in the key and does not block it', withHistory(async () => {
                await keyed('user-1', 'serial', { jobId: 'a' });
                const [first] = await claim();
                await repository.finish([fail(first)]);
                await keyed('user-1', 'serial', { jobId: 'b' });
                const [running] = await claim();

                expect(await repository.retry(['a', 'missing'])).toEqual(['a']);
                expect(await claimIds()).toEqual([]);
                await repository.finish([complete(running)]);

                const [retried] = await claim();
                expect(retried.jobId).toBe('a');
                expect(retried.attempts.map(attempt => [attempt.attemptNumber, attempt.status])).toEqual([
                    [1, 'failed'],
                    [1, 'retried'],
                    [2, undefined],
                ]);
                await repository.finish([complete(retried)]);
                await keyed('user-1', 'serial', { jobId: 'c' });
                expect(await claimIds()).toEqual(['c']);
            }));
        });

        describe('starts budget and attempts', () => {
            it('fails a job at claim once it has used maxStarted, with the per-job value winning', async () => {
                await enqueue({ jobId: 'job-limit', retry: { maxStarted: 1 } });
                await enqueue({ jobId: 'type-limit' });
                const claimed = await claim({ maxStarted: 2 });
                await repository.finish(claimed.map(found => requeue(found, time, 'aborted')));

                const result = await repository.claim([{ jobType: 'mail', free: 10, leaseMs: LEASE_MS, maxStarted: 2 }], WORKER);

                expect(result.claimed.map(found => found.jobId)).toEqual(['type-limit']);
                expect(result.transitions).toEqual([{ jobId: 'job-limit', seq: expect.any(Number), jobType: 'mail', attemptNumber: 1, finalStatus: 'failed' }]);
            });

            it('trims long attempt lists but keeps numbering', async () => {
                const { jobId } = await enqueue();
                for (let index = 0; index < 60; index++) {
                    const [claimed] = await claim();
                    await repository.finish([requeue(claimed, time, 'snoozed')]);
                }
                const [claimed] = await claim();

                expect(claimed.attempts.length).toBeLessThanOrEqual(50);
                expect(lastAttempt(claimed)).toBe(61);
                expect(claimed.jobId).toBe(jobId);
            });
        });

        describe('rate limits and throttles', () => {
            it('limits starts per type with rate', async () => {
                for (let index = 0; index < 5; index++) await enqueue();
                const rate = { max: 2, durationMs: 1000 };

                const first = await claimIds({ rate });
                const tooSoon = await claimIds({ rate });
                advance(500);
                const later = await claimIds({ rate });

                expect([first.length, tooSoon.length, later.length]).toEqual([2, 0, 1]);
            });

            it('limits starts per group with groupRate and running per group with maxRunningPerGroup', async () => {
                for (const jobGroup of ['a', 'a', 'a', 'b']) await enqueue({ jobGroup });

                const groupRate = (await claim({ groupRate: { max: 1, durationMs: 1000 } })).map(found => found.jobGroup);
                expect(groupRate.sort()).toEqual(['a', 'b']);

                advance(1000);
                const perGroup = (await claim({ maxRunningPerGroup: 1 })).map(found => found.jobGroup);
                expect(perGroup).toEqual([]);
            });

            it('rotates groups with fairness', async () => {
                for (const jobGroup of ['a', 'a', 'a', 'b', 'c']) await enqueue({ jobGroup });

                const groups = (await claim({ free: 3, fairness: true })).map(found => found.jobGroup);

                expect(groups.sort()).toEqual(['a', 'b', 'c']);
            });

            it('pauses a type through a throttling outcome until nextStartAt', async () => {
                await enqueue({ jobId: 'a' });
                await enqueue({ jobId: 'b' });
                const [claimed] = await claim({ free: 1 });

                await repository.finish([{ ...requeue(claimed, START + 100, 'snoozed'), throttle: { nextStartAt: START + 100 } }]);

                expect(await claimIds()).toEqual([]);
                advance(100);
                await repository.promote(['mail']);
                expect((await claimIds()).sort()).toEqual(['a', 'b']);
            });

            it('pauses only the group through a group throttling outcome', async () => {
                await enqueue({ jobId: 'a1', jobGroup: 'a' });
                await enqueue({ jobId: 'a2', jobGroup: 'a' });
                await enqueue({ jobId: 'b1', jobGroup: 'b' });
                const [claimed] = await claim({ free: 1 });
                expect(claimed.jobId).toBe('a1');

                await repository.finish([
                    { ...requeue(claimed, START + 100, 'snoozed'), throttle: { jobGroup: 'a', nextStartAt: START + 100 } },
                ]);

                expect(await claimIds()).toEqual(['b1']);
            });

            it('pauses and resumes a type through throttle()', async () => {
                await enqueue();
                await repository.throttle('mail', undefined, Number.MAX_SAFE_INTEGER);
                expect(await claimIds()).toEqual([]);

                await repository.throttle('mail', undefined, undefined);
                expect(await claimIds()).toHaveLength(1);
            });
        });

        describe('start deadline', () => {
            it('expires a job that did not start before max(createdAt, runAfter) + deadline', async () => {
                await enqueue({ jobId: 'delayed', runAfter: START + 1000 });
                await enqueue({ jobId: 'now' });
                advance(600);

                const first = await repository.promote(['mail'], { mail: 500 });
                expect(first.transitions.map(transition => transition.jobId)).toEqual(['now']);

                advance(1000);
                const second = await repository.promote(['mail'], { mail: 500 });
                expect(second.transitions).toEqual([{ jobId: 'delayed', seq: expect.any(Number), jobType: 'mail', attemptNumber: undefined, finalStatus: 'expired' }]);
            });

            it('does not expire a job that already started', async () => {
                await enqueue({ jobId: 'started' });
                const [claimed] = await claim();
                await repository.finish([requeue(claimed, START + 10_000)]);
                advance(5000);

                expect((await repository.promote(['mail'], { mail: 500 })).transitions).toEqual([]);
            });
        });

        describe('admin operations', () => {
            it('retries a finished job with a retried marker that resets the budget', withHistory(async () => {
                const { jobId } = await enqueue();
                const [claimed] = await claim();
                await repository.finish([fail(claimed)]);
                advance(50);

                expect(await repository.retry([jobId])).toEqual([jobId]);
                const [again] = await claim();

                expect(again.createdAt).toBe(START + 50);
                expect(again.attempts.map(attempt => attempt.status)).toEqual(['failed', 'retried', undefined]);
                expect(await repository.retry([jobId])).toEqual([]);
            }));

            it('removes waiting and finished jobs and refuses a running one', withHistory(async () => {
                const finished = await enqueue();
                const [claimed] = await claim({ free: 1 });
                await repository.finish([complete(claimed)]);
                const running = await enqueue();
                await claim({ free: 1 });
                const waiting = await enqueue();

                expect((await repository.remove([waiting.jobId, finished.jobId, running.jobId, 'missing'])).sort()).toEqual(
                    [waiting.jobId, finished.jobId].sort()
                );
                expect(await repository.get(waiting.jobId)).toBeUndefined();
                expect(await repository.get(finished.jobId)).toBeUndefined();
                expect(((await repository.get(running.jobId)) as TCNSJobState).lockedUntil).toBeDefined();
            }));

            it('lists live jobs by run time and seq, filtered by type and running, page by page', withHistory(async () => {
                const finished = await enqueue();
                await repository.finish([complete((await claim({ free: 1 }))[0])]);
                const running = await enqueue();
                await claim({ free: 1 });
                const later = await enqueue({ runAfter: START + 1_000 });
                const ready = await enqueue();
                const sms = await enqueue({ jobType: 'sms' });
                const ids = (jobs: TCNSJobState[]) => jobs.map(found => found.jobId);

                const all = await repository.list();
                const first = await repository.list({ jobTypes: ['mail'], running: false, limit: 1 });
                const last = first[first.length - 1];
                const second = await repository.list({ jobTypes: ['mail'], running: false, after: { runAfter: last.runAfter, seq: last.seq } });

                expect(ids(all)).toEqual([running.jobId, ready.jobId, sms.jobId, later.jobId]);
                expect(ids(all)).not.toContain(finished.jobId);
                expect(ids(first)).toEqual([ready.jobId]);
                expect(ids(second)).toEqual([later.jobId]);
                expect(second[0]).toMatchObject({ wait: 'scheduled', runAfter: START + 1_000, payload: { n: 1 } });
                expect(ids(await repository.list({ running: true }))).toEqual([running.jobId]);
            }));

            it('runs a delayed job now, keeps a keyed one behind its key, and leaves running and unknown jobs alone', async () => {
                const running = await enqueue({ jobKey: 'k' });
                const [claimed] = await claim({ free: 1 });
                const delayed = await enqueue({ runAfter: START + 60_000 });
                const keyed = await enqueue({ jobKey: 'k', runAfter: START + 60_000 }, { keyMode: 'serial' });

                expect((await repository.runNow([delayed.jobId, keyed.jobId, running.jobId, 'missing'])).sort()).toEqual([delayed.jobId, keyed.jobId].sort());
                expect(await claimIds()).toEqual([delayed.jobId]);
                expect(await repository.get(keyed.jobId)).toMatchObject({ wait: 'key', runAfter: START });
                expect(((await repository.get(claimed.jobId)) as TCNSJobState).lockedUntil).toBeDefined();
            });

            it('changes the priority of waiting jobs so they are claimed first, and refuses a fractional priority', async () => {
                const first = await enqueue();
                const second = await enqueue();

                expect(await repository.prioritize([second.jobId, 'missing'], 5)).toEqual([second.jobId]);
                expect(await claimIds({ free: 1 })).toEqual([second.jobId]);
                expect(await repository.prioritize([second.jobId], 9)).toEqual([]);
                await expect(repository.prioritize([first.jobId], 1.5)).rejects.toThrow('priority must be an integer');
            });

            it('returns copies from get that do not change stored jobs', async () => {
                const { jobId } = await enqueue();
                const found = (await repository.get(jobId)) as TCNSJobState;
                found.payload = 'changed';

                expect(((await repository.get(jobId)) as TCNSJobState).payload).toEqual({ n: 1 });
            });
        });

        describe('maintenance', () => {
            const finishMany = async (count: number) => {
                for (let index = 0; index < count; index++) {
                    await enqueue({ jobId: `done-${index}` });
                    const [claimed] = await claim();
                    await repository.finish([complete(claimed)]);
                    advance(10);
                }
            };

            it('keeps the newest keepCount finished jobs per type and status', withHistory(async () => {
                await finishMany(4);

                const removed = await repository.maintain({ mail: { completed: { keepCount: 2 } } }, {});

                expect(removed.sort()).toEqual(['done-0', 'done-1']);
                expect(await repository.get('done-3')).toBeDefined();
            }));

            it('drops finished jobs older than keepAgeMs or the horizon', withHistory(async () => {
                await finishMany(3);

                expect((await repository.maintain({ mail: { completed: { keepAgeMs: 15 } } }, {})).sort()).toEqual(['done-0', 'done-1']);
                advance(1000);
                expect(await repository.maintain({}, {}, 500)).toEqual(['done-2']);
            }));

            it('keeps finished jobs inside the dedup window of their type from keepCount and keepAgeMs, not from the horizon', withHistory(async () => {
                await finishMany(3);

                const removed = await repository.maintain({ mail: { completed: { keepCount: 0, keepAgeMs: 0 } } }, { mail: 15 });

                expect(removed.sort()).toEqual(['done-0', 'done-1']);
                expect(await repository.maintain({}, { mail: 10_000 }, 5)).toEqual(['done-2']);
            }));

            it('deletes the logs of a removed job together with it', async () => {
                const { jobId } = await enqueue({ jobId: 'logged' });
                await repository.logRepository.append(jobId, [{ attemptNumber: 1, seq: 1, at: START, kind: 'log' }]);

                await repository.remove([jobId]);

                expect(await repository.logRepository.list(jobId)).toEqual([]);
            });

            it('deletes the logs of a job swept from history together with it', withHistory(async () => {
                await finishMany(1);
                await repository.logRepository.append('done-0', [{ attemptNumber: 1, seq: 1, at: START, kind: 'log' }]);

                await repository.maintain({ mail: { completed: { keepCount: 0 } } }, {});

                expect(await repository.logRepository.list('done-0')).toEqual([]);
            }));

            it('deletes the logs of a job that leaves without history, and keeps the logs of a job enqueued again under its id', async () => {
                if (repository.capabilities.history) return;
                await enqueue({ jobId: 'reused' });
                const [first] = await claim();
                await repository.logRepository.append('reused', [{ attemptNumber: 1, seq: 1, at: START, kind: 'log', entry: 'first' }]);
                await repository.finish([complete(first)]);

                expect(await repository.logRepository.list('reused')).toEqual([]);

                await enqueue({ jobId: 'reused' });
                await claim();
                await repository.logRepository.append('reused', [{ attemptNumber: 1, seq: 1, at: START, kind: 'log', entry: 'second' }]);
                await repository.maintain({}, {}, 0);

                expect((await repository.logRepository.list('reused')).map(entry => entry.entry)).toEqual(['second']);
            });

            it('replaces the history row and logs of an id enqueued again after its idempotency window', withHistory(async () => {
                await enqueue({ jobId: 'again' }, { idempotencyWindowMs: 5 });
                const [first] = await claim();
                await repository.logRepository.append('again', [{ attemptNumber: 1, seq: 1, at: START, kind: 'log', entry: 'first' }]);
                await repository.finish([complete(first)]);
                advance(10);

                expect((await enqueue({ jobId: 'again' }, { idempotencyWindowMs: 5 })).status).toBe('inserted');
                await repository.logRepository.append('again', [{ attemptNumber: 1, seq: 1, at: START, kind: 'log', entry: 'second' }]);
                await repository.maintain({ mail: { completed: { keepCount: 0 } } }, {});

                expect((await repository.logRepository.list('again')).map(entry => entry.entry)).toEqual(['second']);
                expect(await repository.get('again')).not.toHaveProperty('finalStatus');
                await repository.remove(['again']);
                expect(await repository.get('again')).toBeUndefined();
            }));

            it('deletes the logs of a job superseded without history', async () => {
                if (repository.capabilities.history) return;
                const { jobId: head } = await keyed('user-1', 'latest');
                const [claimed] = await claim();
                await repository.logRepository.append(head, [{ attemptNumber: 1, seq: 1, at: START, kind: 'log' }]);
                await repository.finish([requeue(claimed, time + 60_000)]);

                await keyed('user-1', 'latest');

                expect(await repository.logRepository.list(head)).toEqual([]);
            });

            it('reports nothing to repair when keys are consistent', async () => {
                await keyed('user-1', 'serial');
                await keyed('user-1', 'serial');

                expect(await repository.repairKeys(['mail'])).toEqual([]);
            });
        });

        describe('schedules and types', () => {
            it('upserts, lists and removes schedules by their cluster-wide id', async () => {
                await repository.upsertSchedules('mail', [{ scheduleId: 'mail-daily', cron: '0 9 * * *' }], true);
                await repository.upsertSchedules('mail', [{ scheduleId: 'mail-manual', everyMs: 1000 }], false);
                await repository.upsertSchedules('sms', [{ scheduleId: 'sms-daily', everyMs: 5000 }], true);
                await repository.upsertSchedules('mail', [{ scheduleId: 'mail-daily', cron: '0 10 * * *' }], true);

                const listed = await repository.listSchedules(['mail']);
                expect(listed.map(schedule => [schedule.scheduleId, schedule.cron ?? schedule.everyMs, schedule.fromDefinition]).sort()).toEqual([
                    ['mail-daily', '0 10 * * *', true],
                    ['mail-manual', 1000, false],
                ]);

                await repository.removeSchedules('mail', ['mail-daily', 'sms-daily']);
                expect((await repository.listSchedules(['mail', 'sms'])).map(schedule => `${schedule.jobType}:${schedule.scheduleId}`).sort()).toEqual([
                    'mail:mail-manual',
                    'sms:sms-daily',
                ]);
            });

            it('counts live handlers per type and releases them once', async () => {
                const releaseFirst = await repository.registerTypes([{ jobType: 'mail', meta: {} }]);
                const releaseSecond = await repository.registerTypes([{ jobType: 'mail', meta: {} }, { jobType: 'sms', meta: {} }]);

                const handlers = async () =>
                    Object.fromEntries((await repository.listTypes()).map(status => [status.jobType, status.handlers]));
                expect(await handlers()).toEqual({ mail: 2, sms: 1 });

                await releaseFirst();
                await releaseFirst();
                expect(await handlers()).toEqual({ mail: 1, sms: 1 });

                await releaseSecond();
                expect(await handlers()).toEqual({ mail: 0, sms: 0 });
            });

            it('replaces the meta of a type with the one each registration brings', async () => {
                const meta = async () => (await repository.listTypes()).find(status => status.jobType === 'mail')?.meta;

                await (await repository.registerTypes([{ jobType: 'mail', meta: { payloadSchema: { type: 'object' } } }]))();
                expect(await meta()).toEqual({ payloadSchema: { type: 'object' } });

                await (await repository.registerTypes([{ jobType: 'mail', meta: {} }]))();
                expect(await meta()).toEqual({});
            });
        });
    });
}
