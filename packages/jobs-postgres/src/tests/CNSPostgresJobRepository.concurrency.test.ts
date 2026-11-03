import { afterAll, afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import { CNSJobQueue, CNSJobWorker } from '@cnstra/jobs';
import type { TCNSJobClaimRequest, TCNSJobHistoryState, TCNSJobState } from '@cnstra/jobs';
import { Pool } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
import { CNSPgJobDatabase } from '../database/CNSPgJobDatabase';
import { CNSPostgresJobRepository } from '../repository/CNSPostgresJobRepository';
import { CNSPostgresJobSchema } from '../schema/CNSPostgresJobSchema';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

jest.setTimeout(60_000);

const database = new CNSPostgresTestDatabase('cnstest_concurrency_');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const pauseAfter = (pool: Pool, pattern: RegExp, ms: number) => {
    const paused = new WeakSet<PoolClient>();
    const connect = pool.connect.bind(pool) as () => Promise<PoolClient>;
    const pausedConnect = async () => {
        const client = await connect();
        if (paused.has(client)) return client;
        paused.add(client);
        const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<QueryResult>;
        const pausedQuery = async (text: string, values?: unknown[]) => {
            const result = await query(text, values);
            if (pattern.test(text)) await sleep(ms);
            return result;
        };
        Object.assign(client, { query: pausedQuery });
        return client;
    };
    Object.assign(pool, { connect: pausedConnect });
};

CNSPostgresTestDatabase.describe('CNSPostgresJobRepository under concurrent processes', () => {
    const pools: Pool[] = [];
    const repositories: CNSPostgresJobRepository[] = [];

    const poolOf = (repository: CNSPostgresJobRepository) => pools[repositories.indexOf(repository)];

    const processes = (count: number) =>
        Array.from({ length: count }, () => {
            const pool = new Pool({ connectionString: CNSPostgresTestDatabase.url, max: 4 });
            const repository = new CNSPostgresJobRepository({ database: new CNSPgJobDatabase(pool), tablePrefix: database.tablePrefix });
            pools.push(pool);
            repositories.push(repository);
            return repository;
        });

    const drain = async (
        repository: CNSPostgresJobRepository,
        request: TCNSJobClaimRequest,
        onClaim: (claimed: TCNSJobState[]) => Promise<void>,
        producing: () => boolean = () => false
    ) => {
        for (let idle = 0; idle < 20 || producing(); ) {
            const { claimed } = await repository.claim([request], 'worker');
            if (claimed.length === 0) {
                idle++;
                await sleep(5);
                continue;
            }
            idle = 0;
            await onClaim(claimed);
            await repository.finish(
                claimed.map(jobState => ({
                    jobId: jobState.jobId,
                    seq: jobState.seq,
                    attemptNumber: jobState.attempts[jobState.attempts.length - 1].attemptNumber,
                    kind: 'completed' as const,
                }))
            );
        }
    };

    const finishedStatuses = async () => {
        const result = await database.pool.query<{ final_status: string; count: number }>(
            `SELECT final_status, count(*)::int AS count FROM ${database.tablePrefix}job_history GROUP BY final_status`
        );
        return Object.fromEntries(result.rows.map(row => [row.final_status, row.count]));
    };

    beforeAll(() => database.migrate());
    beforeEach(() => database.truncate());
    afterEach(async () => {
        await Promise.all(repositories.splice(0).map(repository => repository.close()));
        await Promise.all(pools.splice(0).map(pool => pool.end()));
    });
    afterAll(() => database.end());

    it('migrates from several processes at once on an empty database', async () => {
        const fresh = new CNSPostgresTestDatabase('cnstest_migrate_');
        await fresh.drop();
        const starting = processes(4).map((_, index) => new CNSPgJobDatabase(pools[index]));

        await expect(Promise.all(starting.map(each => CNSPostgresJobSchema.migrate(each, 'cnstest_migrate_')))).resolves.toHaveLength(4);
        await fresh.end();
    });

    it('never hands one attempt to two processes', async () => {
        const [producer, ...workers] = processes(5);
        await producer.enqueue(Array.from({ length: 200 }, (_, index) => ({ job: { jobType: 'mail', payload: index } })));

        const claimedIds: string[] = [];
        await Promise.all(
            workers.map(worker =>
                drain(worker, { jobType: 'mail', free: 5, leaseMs: 30_000 }, async claimed => {
                    claimedIds.push(...claimed.map(jobState => jobState.jobId));
                })
            )
        );

        expect(claimedIds).toHaveLength(200);
        expect(new Set(claimedIds).size).toBe(200);
        expect(await finishedStatuses()).toEqual({ completed: 200 });
    });

    it('keeps one running job per key across processes and runs each key in order', async () => {
        const [producer, ...workers] = processes(5);
        await producer.enqueue(
            Array.from({ length: 60 }, (_, index) => ({ job: { jobType: 'mail', payload: index, jobKey: `user-${index % 4}` }, keyMode: 'serial' as const }))
        );

        const runningKeys = new Set<string>();
        const order = new Map<string, number[]>();
        let conflicts = 0;
        await Promise.all(
            workers.map(worker =>
                drain(worker, { jobType: 'mail', free: 3, leaseMs: 30_000 }, async claimed => {
                    for (const jobState of claimed) {
                        const key = jobState.jobKey ?? '';
                        if (runningKeys.has(key)) conflicts++;
                        runningKeys.add(key);
                        order.set(key, [...(order.get(key) ?? []), jobState.payload as number]);
                    }
                    await sleep(2);
                    for (const jobState of claimed) runningKeys.delete(jobState.jobKey ?? '');
                })
            )
        );

        expect(conflicts).toBe(0);
        expect(await finishedStatuses()).toEqual({ completed: 60 });
        for (const payloads of order.values()) expect(payloads).toEqual([...payloads].sort((a, b) => a - b));
    });

    it('holds maxRunning across processes', async () => {
        const [producer, ...workers] = processes(5);
        await producer.enqueue(Array.from({ length: 60 }, (_, index) => ({ job: { jobType: 'mail', payload: index } })));

        let peak = 0;
        await Promise.all(
            workers.map(worker =>
                drain(worker, { jobType: 'mail', free: 3, leaseMs: 30_000, maxRunning: 4 }, async () => {
                    const running = await database.pool.query<{ count: number }>(
                        `SELECT count(*)::int AS count FROM ${database.tablePrefix}job WHERE locked_until IS NOT NULL`
                    );
                    peak = Math.max(peak, running.rows[0].count);
                    await sleep(3);
                })
            )
        );

        expect(peak).toBeLessThanOrEqual(4);
        expect(await finishedStatuses()).toEqual({ completed: 60 });
    });

    it('leaves one pending job per key when processes enqueue latest at once', async () => {
        const producers = processes(4);

        await Promise.all(
            producers.map((producer, worker) =>
                Promise.all(
                    Array.from({ length: 15 }, (_, index) =>
                        producer.enqueue([{ job: { jobType: 'mail', payload: { worker, index }, jobKey: 'user-1' }, keyMode: 'latest' }])
                    )
                )
            )
        );

        const live = await database.pool.query(`SELECT job_id FROM ${database.tablePrefix}job WHERE job_key = 'user-1'`);
        expect(live.rowCount).toBe(1);
    });

    it('does not hand a pending job to a worker while latest replaces its payload', async () => {
        const [producer, worker] = processes(2);
        await producer.enqueue([{ job: { jobType: 'mail', payload: 'old', jobKey: 'user-1' }, keyMode: 'latest' }]);
        pauseAfter(poolOf(producer), /WHERE job_key = \$1 ORDER BY seq/, 300);

        const replacing = producer.enqueue([{ job: { jobType: 'mail', payload: 'new', jobKey: 'user-1' }, keyMode: 'latest' }]);
        await sleep(100);
        const during = await worker.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker');
        const [replaced] = await replacing;
        const after = await worker.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker');

        expect(replaced.status).toBe('replaced');
        expect([...during.claimed, ...after.claimed].map(jobState => jobState.payload)).toEqual(['new']);
    });

    it('does not deadlock a finish that throttles a type with a claim of limited types', async () => {
        const [first, second] = processes(2);
        await first.enqueue([{ job: { jobType: 'b', payload: 0 } }, { job: { jobType: 'a', payload: 0 } }, { job: { jobType: 'a', payload: 1 } }]);
        const requests = ['a', 'b'].map(jobType => ({ jobType, free: 1, leaseMs: 30_000, maxRunning: 5 }));
        const [running] = (await first.claim([{ jobType: 'b', free: 1, leaseMs: 30_000 }], 'first')).claimed;
        pauseAfter(poolOf(first), /INSERT INTO \S+job_type \(job_type, next_start_at\)/, 300);

        const finishing = first.finish(
            [
                {
                    jobId: running.jobId,
                    seq: running.seq,
                    attemptNumber: running.attempts[0].attemptNumber,
                    kind: 'completed',
                    throttle: { nextStartAt: Date.now() - 1 },
                },
            ],
            { requests, workerId: 'first' }
        );
        await sleep(100);
        const claiming = second.claim(requests, 'second');

        await expect(Promise.all([finishing, claiming])).resolves.toHaveLength(2);
    });

    it('runs every job exactly once with two workers on one database', async () => {
        const [first, second] = processes(2);
        const runs = new Map<number, number>();
        const handler = {
            definition: { jobType: 'mail', concurrency: 4 },
            run: async (payload: unknown) => {
                runs.set(payload as number, (runs.get(payload as number) ?? 0) + 1);
                await sleep(1);
                return payload;
            },
        };
        const workers = [first, second].map(repository => new CNSJobWorker({ repository, handlers: [handler], pollIntervalMs: 20, promoteIntervalMs: 20 }));
        await Promise.all(workers.map(worker => worker.start()));

        const queue = new CNSJobQueue({ repository: first });
        const results = await queue.enqueueMany(Array.from({ length: 80 }, (_, index) => ({ jobType: 'mail', payload: index })));
        const ids = results.map(result => result?.jobId ?? '');
        for (let waited = 0; waited < 20_000; waited += 50) {
            const finished = await Promise.all(ids.map(jobId => first.get(jobId)));
            if (finished.every(found => found !== undefined && 'finalStatus' in found)) break;
            await sleep(50);
        }
        await Promise.all(workers.map(worker => worker.stop()));

        const finished = (await Promise.all(ids.map(jobId => first.get(jobId)))) as TCNSJobHistoryState[];
        expect(finished.map(found => found.finalStatus)).toEqual(ids.map(() => 'completed'));
        expect([...runs.values()].every(count => count === 1)).toBe(true);
        expect(runs.size).toBe(80);
    });
});
