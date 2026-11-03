import { Pool } from 'pg';
import { CNSPgBossProgressRepository } from '.././CNSPgBossProgressRepository';
import { CNSPgBossProgressSchema } from '.././schema/CNSPgBossProgressSchema';
import type { TCNSProgress } from '@cnstra/persist-dto';

const URL = process.env.DATABASE_URL;
const prefix = 'cnstest_pgboss_';

const progress: TCNSProgress = {
    tasks: [{ neuronName: 'n2', dendriteCollateralName: 'n1.step1Out' }],
    modalityName: 'web',
};

test('rejects an unsafe table prefix', () => {
    expect(() => CNSPgBossProgressSchema.assertTablePrefix('bad; drop table x')).toThrow('unsafe table prefix');
    expect(() => new CNSPgBossProgressRepository({ connectionString: 'postgres://unused', tablePrefix: 'bad-name' })).toThrow('unsafe table prefix');
});

(URL ? describe : describe.skip)('CNSPgBossProgressRepository (live Postgres)', () => {
    const pool = new Pool({ connectionString: URL });
    let now = 1_000_000;
    const repo = new CNSPgBossProgressRepository({ pool, tablePrefix: prefix, now: () => now });

    const drop = () => pool.query(`DROP TABLE IF EXISTS ${CNSPgBossProgressSchema.table(prefix)}, ${CNSPgBossProgressSchema.migrationTable(prefix)}`);

    beforeAll(drop);
    afterAll(async () => {
        await drop();
        await pool.end();
    });

    test('save → load → delete round-trips on a table it creates itself', async () => {
        expect(await repo.load('job-1')).toBeUndefined();
        await repo.save('job-1', progress);
        expect(await repo.load('job-1')).toEqual(progress);
        await repo.delete('job-1');
        expect(await repo.load('job-1')).toBeUndefined();
        await CNSPgBossProgressSchema.verify(pool, prefix);
    });

    test('deleteStale removes rows untouched for longer than the window, by the repository clock', async () => {
        await repo.save('old', progress);
        now += 10_000;
        await repo.save('fresh', progress);

        expect(await repo.deleteStale(5_000)).toBe(1);
        expect(await repo.load('old')).toBeUndefined();
        expect(await repo.load('fresh')).toEqual(progress);
    });
});
