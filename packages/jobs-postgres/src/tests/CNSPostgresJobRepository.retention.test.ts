import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { CNSPostgresJobRepository } from '../repository/CNSPostgresJobRepository';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

const database = new CNSPostgresTestDatabase('cnstest_retention_');
const DAY = 24 * 60 * 60 * 1000;
const dayPartition = (table: string, day: number) => `${database.tablePrefix}${table}_p${new Date(day * DAY).toISOString().slice(0, 10).replace(/-/g, '')}`;

CNSPostgresTestDatabase.describe('CNSPostgresJobRepository history horizon', () => {
    beforeAll(() => database.migrate());
    afterAll(() => database.end());

    it('drops the history days past the horizon, reports their jobs and removes their journal with them', async () => {
        let clock = 10.5 * DAY;
        const repository = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix, now: () => clock });
        const finished = (jobId: string, finishedAt: number) =>
            database.pool.query(
                `INSERT INTO ${database.tablePrefix}job_history (job_id, job_type, priority, created_at, attempts, finished_at, final_status)
                 VALUES ($1, 'mail', 0, $2, '[]', $2, 'completed')`,
                [jobId, finishedAt]
            );
        const logged = (jobId: string, at: number) =>
            database.pool.query(`INSERT INTO ${database.tablePrefix}job_log (job_id, attempt_number, seq, at, kind) VALUES ($1, 1, 0, $2, 'progress')`, [jobId, at]);
        const exists = async (name: string) => (await database.pool.query('SELECT to_regclass($1)::text AS found', [name])).rows[0].found !== null;

        await repository.maintain({}, {}, DAY);
        await finished('before-partitions', 10.6 * DAY);
        await finished('in-partition', 11.2 * DAY);
        await finished('kept', 12.8 * DAY);
        await logged('in-partition', 11.1 * DAY);
        await logged('kept', 12.7 * DAY);
        await logged('still-running', 11.0 * DAY);
        expect(await exists(dayPartition('job_history', 11))).toBe(true);

        clock = 13.5 * DAY;
        const removed = await repository.maintain({}, {}, DAY);

        expect(removed.sort()).toEqual(['before-partitions', 'in-partition']);
        expect(await exists(dayPartition('job_history', 11))).toBe(false);
        const left = await database.pool.query(`SELECT job_id FROM ${database.tablePrefix}job_history ORDER BY job_id`);
        expect(left.rows.map(row => row.job_id)).toEqual(['kept']);
        const logs = await database.pool.query(`SELECT job_id FROM ${database.tablePrefix}job_log ORDER BY job_id`);
        expect(logs.rows.map(row => row.job_id)).toEqual(['kept', 'still-running']);
        expect(await exists(dayPartition('job_history', 20))).toBe(true);
    });

    it('creates no partitions without a history horizon', async () => {
        const repository = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix, now: () => 30.5 * DAY });

        await repository.maintain({}, {});

        expect((await database.pool.query('SELECT to_regclass($1) AS found', [dayPartition('job_history', 31)])).rows[0].found).toBeNull();
    });
});
