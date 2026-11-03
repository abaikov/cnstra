import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MikroORM } from '@mikro-orm/postgresql';
import { PrismaClient } from '@prisma/client';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import knex from 'knex';
import { Kysely, PostgresDialect } from 'kysely';
import { CNSJobWorker } from '@cnstra/jobs';
import postgres from 'postgres';
import { Sequelize } from 'sequelize';
import { DataSource } from 'typeorm';
import { CNSDrizzleJobConnection } from '../connection/CNSDrizzleJobConnection';
import { CNSKnexJobConnection } from '../connection/CNSKnexJobConnection';
import { CNSKyselyJobConnection } from '../connection/CNSKyselyJobConnection';
import { CNSMikroOrmJobConnection } from '../connection/CNSMikroOrmJobConnection';
import { CNSPgJobConnection } from '../connection/CNSPgJobConnection';
import { CNSPostgresJsJobConnection } from '../connection/CNSPostgresJsJobConnection';
import { CNSPrismaJobConnection } from '../connection/CNSPrismaJobConnection';
import { CNSSequelizeJobConnection } from '../connection/CNSSequelizeJobConnection';
import { CNSTypeOrmJobConnection } from '../connection/CNSTypeOrmJobConnection';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import { CNSPostgresJobRepository } from '../repository/CNSPostgresJobRepository';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

jest.setTimeout(60_000);

const database = new CNSPostgresTestDatabase('cnstest_transaction_');
const url = CNSPostgresTestDatabase.url ?? '';
const ROLLBACK = new Error('rollback');

type TTransactionRunner = {
    run(work: (connection: ICNSPostgresJobTransaction) => Promise<void>): Promise<void>;
    close(): Promise<void>;
};

const runners: Record<string, () => Promise<TTransactionRunner>> = {
    pg: async () => ({
        run: async work => {
            const client = await database.pool.connect();
            try {
                await client.query('BEGIN');
                await work(CNSPgJobConnection.from(client));
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },
        close: async () => undefined,
    }),
    'postgres.js': async () => {
        const sql = postgres(url, { max: 2, onnotice: () => undefined });
        return {
            run: async work => {
                await sql.begin(async transaction => work(CNSPostgresJsJobConnection.from(transaction)));
            },
            close: () => sql.end(),
        };
    },
    knex: async () => {
        const db = knex({ client: 'pg', connection: url, pool: { min: 0, max: 2 } });
        return { run: work => db.transaction(transaction => work(CNSKnexJobConnection.from(transaction))), close: () => db.destroy() };
    },
    kysely: async () => {
        const db = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: database.pool }) });
        return { run: work => db.transaction().execute(transaction => work(CNSKyselyJobConnection.from(transaction))), close: async () => undefined };
    },
    drizzle: async () => {
        const db = drizzle(database.pool);
        return { run: work => db.transaction(transaction => work(CNSDrizzleJobConnection.from(transaction, drizzleSql))), close: async () => undefined };
    },
    typeorm: async () => {
        const dataSource = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
        return { run: work => dataSource.transaction(manager => work(CNSTypeOrmJobConnection.from(manager))), close: () => dataSource.destroy() };
    },
    sequelize: async () => {
        const sequelize = new Sequelize(url, { logging: false });
        return {
            run: async work => {
                await sequelize.transaction(transaction => work(CNSSequelizeJobConnection.from(sequelize, transaction)));
            },
            close: () => sequelize.close(),
        };
    },
    prisma: async () => {
        const prisma = new PrismaClient({ datasourceUrl: url });
        return {
            run: async work => {
                await prisma.$transaction(transaction => work(CNSPrismaJobConnection.from(transaction)));
            },
            close: () => prisma.$disconnect(),
        };
    },
    'mikro-orm': async () => {
        const orm = await MikroORM.init({ clientUrl: url, entities: [], discovery: { warnWhenNoEntities: false }, allowGlobalContext: true });
        return {
            run: work => orm.em.fork().transactional(entityManager => work(CNSMikroOrmJobConnection.from(entityManager))),
            close: () => orm.close(),
        };
    },
};

CNSPostgresTestDatabase.describe('enqueue inside the transaction of an ORM', () => {
    let repository: CNSPostgresJobRepository;

    beforeAll(() => database.migrate());
    beforeEach(async () => {
        await database.truncate();
        repository = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix });
    });
    afterAll(() => database.end());

    const waitForBlockedBy = async (holderPid: number) => {
        for (let waited = 0; waited < 5000; waited += 10) {
            const blocked = await database.pool.query(
                `SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))`,
                [holderPid]
            );
            if (blocked.rowCount) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('the direct enqueue never waited on the business transaction');
    };

    const claimPayloads = async () => {
        await repository.promote(['mail']);
        const { claimed } = await repository.claim([{ jobType: 'mail', free: 10, leaseMs: 30_000 }], 'worker');
        return claimed.map(jobState => jobState.payload).sort();
    };

    for (const [name, open] of Object.entries(runners)) {
        it(`${name}: commits jobs with the business transaction and resolves keyed and own-id jobs after commit`, async () => {
            const runner = await open();
            try {
                let statuses: string[] = [];
                await runner.run(async connection => {
                    const results = await repository.enqueue(
                        [
                            { job: { jobType: 'mail', payload: 'plain' } },
                            { job: { jobType: 'mail', payload: 'own-id', jobId: `own-${name}` } },
                            { job: { jobType: 'mail', payload: 'keyed', jobKey: 'user-1' }, keyMode: 'serial' },
                        ],
                        { transaction: connection }
                    );
                    statuses = results.map(result => result.status);
                });

                expect(statuses).toEqual(['inserted', 'unchecked', 'unchecked']);
                expect(await claimPayloads()).toEqual(['keyed', 'own-id', 'plain']);
            } finally {
                await runner.close();
            }
        });

        it(`${name}: resolves two latest jobs committed before a promote in the order they were enqueued, keeping the newest payload`, async () => {
            const runner = await open();
            try {
                for (const payload of ['first', 'second']) {
                    await runner.run(async connection => {
                        await repository.enqueue([{ job: { jobType: 'mail', payload, jobKey: 'user-1' }, keyMode: 'latest' }], { transaction: connection });
                    });
                }

                expect(await claimPayloads()).toEqual(['second']);
            } finally {
                await runner.close();
            }
        });

        it(`${name}: leaves nothing behind when the business transaction rolls back`, async () => {
            const runner = await open();
            try {
                await expect(
                    runner.run(async connection => {
                        await repository.enqueue([{ job: { jobType: 'mail', payload: 'lost', jobId: 'rolled-back' } }], { transaction: connection });
                        throw ROLLBACK;
                    })
                ).rejects.toBe(ROLLBACK);

                expect(await repository.get('rolled-back')).toBeUndefined();
                expect(await claimPayloads()).toEqual([]);
            } finally {
                await runner.close();
            }
        });
    }

    it('applies key modes and idempotency to jobs enqueued in a transaction once they are committed', async () => {
        await repository.enqueue([{ job: { jobType: 'mail', payload: 'old', jobKey: 'user-1' }, keyMode: 'latest' }]);
        const runner = await runners.pg();
        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'new', jobKey: 'user-1' }, keyMode: 'latest' }], { transaction: connection });
        });

        expect(await claimPayloads()).toEqual(['new']);

        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'once', jobId: 'once' } }], { transaction: connection });
        });
        await repository.promote(['mail']);
        const { claimed } = await repository.claim([{ jobType: 'mail', free: 10, leaseMs: 30_000 }], 'worker');
        await repository.finish(claimed.map(jobState => ({ jobId: jobState.jobId, seq: jobState.seq, attemptNumber: 1, kind: 'completed' as const })));
        expect(await repository.get('once')).toMatchObject({ finalStatus: 'completed' });
        await runner.run(async connection => {
            expect((await repository.enqueue([{ job: { jobType: 'mail', payload: 'twice', jobId: 'once' } }], { transaction: connection }))[0].status).toBe(
                'unchecked'
            );
        });

        expect(await claimPayloads()).toEqual([]);
        expect(await repository.get('once')).toMatchObject({ finalStatus: 'completed', payload: 'once' });
    });

    describe('cancelling a job enqueued in a transaction before a promote checked it', () => {
        const committed = async (requests: Parameters<CNSPostgresJobRepository['enqueue']>[0], on = repository) => {
            const runner = await runners.pg();
            await runner.run(async connection => {
                await on.enqueue(requests, { transaction: connection });
            });
        };
        const finish = async (on = repository) => {
            await on.promote(['mail']);
            const { claimed } = await on.claim([{ jobType: 'mail', free: 10, leaseMs: 30_000 }], 'worker');
            await on.finish(claimed.map(jobState => ({ jobId: jobState.jobId, seq: jobState.seq, attemptNumber: 1, kind: 'completed' as const })));
        };

        it('cancels nothing when the enqueue would have been deduplicated by a finished run of its id', async () => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'once', jobId: 'once' } }]);
            await repository.promote(['mail']);
            const { claimed } = await repository.claim([{ jobType: 'mail', free: 10, leaseMs: 30_000 }], 'worker');
            await repository.logRepository.append('once', [{ attemptNumber: 1, seq: 0, at: 1, kind: 'progress', entry: { step: 1 } }]);
            await repository.finish(claimed.map(jobState => ({ jobId: jobState.jobId, seq: jobState.seq, attemptNumber: 1, kind: 'completed' as const })));
            await committed([{ job: { jobType: 'mail', payload: 'twice', jobId: 'once' } }]);

            expect(await repository.cancel(['once'])).toEqual({ cancelled: [], requested: [] });

            expect(await repository.get('once')).toMatchObject({ finalStatus: 'completed', payload: 'once' });
            expect(await repository.logRepository.list('once')).toHaveLength(1);
        });

        it('records the cancel of an enqueue that would have taken over an id whose idempotency window ended', async () => {
            let clock = 1_000;
            const clocked = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix, now: () => clock });
            await clocked.enqueue([{ job: { jobType: 'mail', payload: 'first', jobId: 'reused' } }]);
            await finish(clocked);
            clock = 10_000;
            await committed([{ job: { jobType: 'mail', payload: 'second', jobId: 'reused' }, idempotencyWindowMs: 1_000 }], clocked);

            expect((await clocked.cancel(['reused'])).cancelled).toEqual(['reused']);

            expect(await clocked.get('reused')).toMatchObject({ finalStatus: 'cancelled', payload: 'second' });
        });

        it('cancels nothing when a leading key already has a holder', async () => {
            const [holder] = await repository.enqueue([{ job: { jobType: 'mail', payload: 'holder', jobKey: 'user-1' }, keyMode: 'leading' }]);
            await committed([{ job: { jobType: 'mail', payload: 'late', jobKey: 'user-1', jobId: 'late' }, keyMode: 'leading' }]);

            expect(await repository.cancel(['late'])).toEqual({ cancelled: [], requested: [] });

            expect(await repository.get('late')).toBeUndefined();
            expect(await repository.get(holder.jobId)).toMatchObject({ payload: 'holder' });
        });

        it('merges a latest enqueue into a pending holder, as a direct enqueue would, so there is nothing to cancel', async () => {
            const [holder] = await repository.enqueue([{ job: { jobType: 'mail', payload: 'old', jobKey: 'user-1' }, keyMode: 'latest' }]);
            await committed([{ job: { jobType: 'mail', payload: 'new', jobKey: 'user-1', jobId: 'new' }, keyMode: 'latest' }]);

            expect(await repository.cancel(['new'])).toEqual({ cancelled: [], requested: [] });

            expect(await repository.get(holder.jobId)).toMatchObject({ payload: 'new' });
        });

        it('supersedes the retrying head a latest enqueue replaces, then cancels the enqueue, and reports both', async () => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'head', jobKey: 'user-1', jobId: 'head' }, keyMode: 'latest' }]);
            const [head] = (await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker')).claimed;
            await repository.finish([{ jobId: head.jobId, seq: head.seq, attemptNumber: 1, kind: 'requeue', attemptStatus: 'failed', runAfter: Date.now() + 60_000 }]);
            await committed([{ job: { jobType: 'mail', payload: 'new', jobKey: 'user-1', jobId: 'new' }, keyMode: 'latest' }]);

            const result = await repository.cancel(['new']);

            expect(result.cancelled).toEqual(['new']);
            expect(result.transitions?.map(transition => [transition.jobId, transition.finalStatus])).toEqual([['head', 'superseded']]);
            expect(await repository.get('head')).toMatchObject({ finalStatus: 'superseded' });
            expect(await repository.get('new')).toMatchObject({ finalStatus: 'cancelled' });
        });
    });

    it('keeps the first of two leading jobs committed before a promote', async () => {
        const runner = await runners.pg();
        for (const payload of ['first', 'second']) {
            await runner.run(async connection => {
                await repository.enqueue([{ job: { jobType: 'mail', payload, jobKey: 'user-1' }, keyMode: 'leading' }], { transaction: connection });
            });
        }

        expect(await claimPayloads()).toEqual(['first']);
    });

    it('reports the retrying head a transactional latest job supersedes', async () => {
        await repository.enqueue([{ job: { jobType: 'mail', payload: 'head', jobKey: 'user-1', jobId: 'head' }, keyMode: 'latest' }]);
        const [head] = (await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker')).claimed;
        await repository.finish([
            { jobId: head.jobId, seq: head.seq, attemptNumber: 1, kind: 'requeue', attemptStatus: 'failed', runAfter: Date.now() + 60_000 },
        ]);
        const runner = await runners.pg();
        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'new', jobKey: 'user-1' }, keyMode: 'latest' }], { transaction: connection });
        });

        const { transitions } = await repository.promote(['mail']);

        expect(transitions.map(transition => [transition.jobId, transition.finalStatus])).toEqual([['head', 'superseded']]);
    });

    it('resolves a transactional keyed job on the unchecked signal, without waiting for the promote tick', async () => {
        const ran: unknown[] = [];
        const worker = new CNSJobWorker({
            repository,
            handlers: [{ definition: { jobType: 'mail' }, run: payload => void ran.push(payload) }],
            promoteIntervalMs: 60_000,
            pollIntervalMs: 60_000,
        });
        await worker.start();
        try {
            const runner = await runners.pg();
            await runner.run(async connection => {
                await repository.enqueue([{ job: { jobType: 'mail', payload: 'keyed', jobKey: 'user-1' }, keyMode: 'serial' }], { transaction: connection });
            });
            for (let waited = 0; waited < 3000 && ran.length === 0; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));

            expect(ran).toEqual(['keyed']);
        } finally {
            await worker.stop();
        }
    });

    it('stops counting the handlers of a closed repository even though its pool lives on', async () => {
        const owned = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix });
        await owned.registerTypes([{ jobType: 'mail', meta: {} }]);
        const handlers = async () => (await repository.listTypes()).find(status => status.jobType === 'mail')?.handlers;
        expect(await handlers()).toBe(1);

        await owned.close();

        expect(await handlers()).toBe(0);
    });

    it('takes the handler liveness lock again after its connection is lost', async () => {
        const errors: unknown[] = [];
        const owned = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix, onError: error => errors.push(error) });
        const release = await owned.registerTypes([{ jobType: 'mail', meta: {} }]);
        const handlers = async () => (await owned.listTypes()).find(status => status.jobType === 'mail')?.handlers;
        expect(await handlers()).toBe(1);

        await database.pool.query(
            `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND classid = 4 AND objsubid = 2 AND pid <> pg_backend_pid()
               AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
               AND objid::bigint = (hashtext($1)::bigint & 4294967295)`,
            [`${database.tablePrefix}mail`]
        );
        let after: number | undefined;
        for (let waited = 0; waited < 5000; waited += 50) {
            await new Promise(resolve => setTimeout(resolve, 50));
            after = await handlers();
            if (after === 1 && errors.length > 0) break;
        }

        expect(errors.length).toBeGreaterThan(0);
        expect(after).toBe(1);
        await release();
        await owned.close();
    });

    it('lets a direct enqueue apply its key mode after a committed transactional job of the same key', async () => {
        const runner = await runners.pg();
        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'old', jobKey: 'user-1' }, keyMode: 'latest' }], { transaction: connection });
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'first', jobKey: 'user-2' }, keyMode: 'leading' }], { transaction: connection });
        });

        const [replaced] = await repository.enqueue([{ job: { jobType: 'mail', payload: 'new', jobKey: 'user-1' }, keyMode: 'latest' }]);
        const [duplicate] = await repository.enqueue([{ job: { jobType: 'mail', payload: 'second', jobKey: 'user-2' }, keyMode: 'leading' }]);

        expect([replaced.status, duplicate.status]).toEqual(['replaced', 'deduplicated']);
        expect(await claimPayloads()).toEqual(['first', 'new']);
    });

    it('reports a direct enqueue of an id an open business transaction inserted as a duplicate once it commits', async () => {
        const client = await database.pool.connect();
        try {
            await client.query('BEGIN');
            const holderPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'business', jobId: 'shared' } }], { transaction: CNSPgJobConnection.from(client) });
            const direct = repository.enqueue([{ job: { jobType: 'mail', payload: 'direct', jobId: 'shared' } }]);
            await waitForBlockedBy(holderPid);
            await client.query('COMMIT');

            expect((await direct)[0].status).toBe('deduplicated');
        } finally {
            client.release();
        }
        expect(await claimPayloads()).toEqual(['business']);
    });

    it('keeps the key untouched when a direct switch enqueue turns out to duplicate an id an open business transaction holds', async () => {
        await repository.enqueue([{ job: { jobType: 'mail', payload: 'running', jobKey: 'user-1' }, keyMode: 'switch' }]);
        const [running] = (await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker')).claimed;
        const client = await database.pool.connect();
        try {
            await client.query('BEGIN');
            const holderPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'business', jobId: 'shared' } }], { transaction: CNSPgJobConnection.from(client) });
            const direct = repository.enqueue([{ job: { jobType: 'mail', payload: 'direct', jobId: 'shared', jobKey: 'user-1' }, keyMode: 'switch' }]);
            await waitForBlockedBy(holderPid);
            await client.query('COMMIT');

            expect((await direct)[0]).toEqual({ jobId: 'shared', status: 'deduplicated', supersededJobIds: [] });
        } finally {
            client.release();
        }
        const lease = { jobId: running.jobId, seq: running.seq, attemptNumber: 1, leaseMs: 30_000 };
        expect((await repository.renew([lease])).cancelRequests).toEqual([]);
    });

    it('reports a retrying head that a direct enqueue supersedes while applying a committed transactional job of its key', async () => {
        await repository.enqueue([{ job: { jobType: 'mail', payload: 'head', jobKey: 'user-1', jobId: 'head' }, keyMode: 'latest' }]);
        const [head] = (await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker')).claimed;
        await repository.finish([
            { jobId: head.jobId, seq: head.seq, attemptNumber: 1, kind: 'requeue', attemptStatus: 'failed', runAfter: Date.now() + 60_000 },
        ]);
        const runner = await runners.pg();
        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'tx', jobKey: 'user-1' }, keyMode: 'latest' }], { transaction: connection });
        });

        const [direct] = await repository.enqueue([{ job: { jobType: 'mail', payload: 'direct', jobKey: 'user-1' }, keyMode: 'latest' }]);

        expect(direct.supersededJobIds).toEqual([]);
        expect(direct.transitions?.map(transition => [transition.jobId, transition.jobType, transition.finalStatus])).toEqual([['head', 'mail', 'superseded']]);
        expect(await claimPayloads()).toEqual(['direct']);
    });

    it('reports a head superseded while applying a committed job of another type with the type of that job', async () => {
        await repository.enqueue([{ job: { jobType: 'mail', payload: 'head', jobKey: 'user-1', jobId: 'head' }, keyMode: 'latest' }]);
        const [head] = (await repository.claim([{ jobType: 'mail', free: 1, leaseMs: 30_000 }], 'worker')).claimed;
        await repository.finish([
            { jobId: head.jobId, seq: head.seq, attemptNumber: 1, kind: 'requeue', attemptStatus: 'failed', runAfter: Date.now() + 60_000 },
        ]);
        const runner = await runners.pg();
        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'tx', jobKey: 'user-1' }, keyMode: 'latest' }], { transaction: connection });
        });

        const [sms] = await repository.enqueue([{ job: { jobType: 'sms', payload: 'sms', jobKey: 'user-1' }, keyMode: 'serial' }]);

        expect(sms.supersededJobIds).toEqual([]);
        expect(sms.transitions?.map(transition => [transition.jobId, transition.jobType, transition.finalStatus])).toEqual([['head', 'mail', 'superseded']]);
    });

    it('applies a committed transactional job with the same own id before judging a direct enqueue of that id', async () => {
        await repository.enqueue([{ job: { jobType: 'mail', payload: 'pending', jobKey: 'user-2' }, keyMode: 'latest' }]);
        const runner = await runners.pg();
        await runner.run(async connection => {
            await repository.enqueue([{ job: { jobType: 'mail', payload: 'merged', jobId: 'X', jobKey: 'user-2' }, keyMode: 'latest' }], { transaction: connection });
        });

        const [direct] = await repository.enqueue([{ job: { jobType: 'mail', payload: 'direct', jobId: 'X' } }]);

        expect(direct.status).toBe('inserted');
        expect(((await repository.get('X')) as { payload?: unknown }).payload).toBe('direct');
        expect(await claimPayloads()).toEqual(['direct', 'merged']);
    });

    it('refuses an ORM transaction or a pool passed without its wrapper', async () => {
        const dataSource = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
        try {
            await dataSource.transaction(async manager => {
                await expect(repository.enqueue([{ job: { jobType: 'mail', payload: 1 } }], { transaction: manager as never })).rejects.toThrow(
                    'pass the transaction as a connection'
                );
            });
            await expect(repository.enqueue([{ job: { jobType: 'mail', payload: 1 } }], { transaction: database.pool as never })).rejects.toThrow(
                'pass the transaction as a connection'
            );
        } finally {
            await dataSource.destroy();
        }
    });

    it('refuses a transaction that is not a connection', async () => {
        await expect(repository.enqueue([{ job: { jobType: 'mail', payload: 1 } }], { transaction: {} as never })).rejects.toThrow('pass the transaction as a connection');
    });
});
