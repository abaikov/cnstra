import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSPgJobConnection, CNSPgJobDatabase, CNSPostgresJobRepository, CNSPostgresJobSchema } from '@cnstra/jobs-postgres';
import type { ICNSPostgresJobTransaction } from '@cnstra/jobs-postgres';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { Pool } from 'pg';
import { CNSJobs } from '../runtime/CNSJobs';

jest.setTimeout(30_000);

const url = process.env.DATABASE_URL;
const prefix = 'cnstest_adapter_';

(url ? describe : describe.skip)('CNSJobs on Postgres', () => {
    const pool = new Pool({ connectionString: url, max: 6 });
    const database = new CNSPgJobDatabase(pool);

    beforeAll(async () => {
        await pool.query(`DROP TABLE IF EXISTS ${[...CNSPostgresJobSchema.tables(prefix), CNSPostgresJobSchema.migrationTable(prefix)].join(', ')} CASCADE; DROP SEQUENCE IF EXISTS ${prefix}job_seq`);
        await CNSPostgresJobSchema.migrate(database, prefix);
    });
    afterAll(async () => {
        await pool.query(`DROP TABLE IF EXISTS ${[...CNSPostgresJobSchema.tables(prefix), CNSPostgresJobSchema.migrationTable(prefix)].join(', ')} CASCADE; DROP SEQUENCE IF EXISTS ${prefix}job_seq`);
        await pool.end();
    });

    it('runs a job enqueued inside a business transaction as a stimulation after the commit, resumes a failed step, wakes waitFor and publishes the payload schema', async () => {
        const orderPlaced = cnsCollateral<{ orderId: number }>();
        const charged = cnsCollateral<{ orderId: number }>();
        const ran: string[] = [];
        let failures = 1;
        const charge = cnsNeuron({ charged }).dendrite({
            collateral: orderPlaced,
            response: (payload, axon) => {
                ran.push('charge');
                return axon.charged.createSignal(payload);
            },
        });
        const notify = cnsNeuron({}).dendrite({
            collateral: charged,
            response: () => {
                ran.push('notify');
                if (failures-- > 0) throw new Error('mail is down');
            },
        });
        const registry = new CNSPersistOptionsRegistry();
        registry.register('charge', charge);
        registry.register('notify', notify);
        registry.registerCollateral('orderPlaced', orderPlaced);
        const repository = new CNSPostgresJobRepository({ database, tablePrefix: prefix });
        const jobs = new CNSJobs<ICNSPostgresJobTransaction>({ cns: new CNS([charge, notify]), registry, repository }).type(orderPlaced, {
            jobKey: payload => `order:${payload.orderId}`,
            keyMode: 'serial',
            retry: { maxFailed: 3, backoff: { type: 'fixed', delayMs: 1 } },
            payloadSchema: { type: 'object', properties: { orderId: { type: 'number' } } },
        });
        const worker = jobs.worker({ pollIntervalMs: 20, promoteIntervalMs: 50, finishBatchMs: 1 });
        await worker.start();
        try {
            const client = await pool.connect();
            let jobId = '';
            try {
                await client.query('BEGIN');
                jobId = (await jobs.enqueue(orderPlaced, { orderId: 9 }, { transaction: CNSPgJobConnection.from(client) }))?.jobId ?? '';
                await client.query('COMMIT');
            } finally {
                client.release();
            }

            const startedWaiting = Date.now();
            const finished = await jobs.waitFor(jobId);

            expect(Date.now() - startedWaiting).toBeLessThan(5_000);
            expect(finished).toMatchObject({ finalStatus: 'completed' });
            expect(ran).toEqual(['charge', 'notify', 'notify']);
            expect((await repository.listTypes()).find(type => type.jobType === 'orderPlaced')?.meta).toEqual({
                payloadSchema: { type: 'object', properties: { orderId: { type: 'number' } } },
            });
        } finally {
            await worker.stop();
            await repository.close();
        }
    });
});
