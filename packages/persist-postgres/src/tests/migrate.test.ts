import { Pool } from 'pg';
import { CNSPostgresStimulationSchema } from '.././schema/CNSPostgresStimulationSchema';

const URL = process.env.DATABASE_URL;
const d = URL ? describe : describe.skip;

describe('CNSPostgresStimulationSchema.migrationSql', () => {
    it('creates every table and records step 1 on an empty database', () => {
        const sql = CNSPostgresStimulationSchema.migrationSql('acme_');

        expect(sql).toContain('CREATE TABLE acme_stimulation (');
        expect(sql).toContain('CREATE TABLE acme_stimulation_task (');
        expect(sql).toContain('CREATE TABLE acme_stimulation_migration');
        expect(sql).toContain("INSERT INTO acme_stimulation_migration (step, kind) VALUES (1, 'expand');");
    });

    it('has nothing to add to a database at the current step', () => {
        expect(CNSPostgresStimulationSchema.migrationSql('acme_', [1])).toBe('');
    });

    it('refuses a prefix that is unsafe or too long for the longest name', () => {
        expect(() => CNSPostgresStimulationSchema.migrationSql('a"; DROP TABLE x; --')).toThrow('unsafe table prefix');
        expect(() => CNSPostgresStimulationSchema.assertTablePrefix('a'.repeat(33))).toThrow('at most 32 characters');
    });
});

d('CNSPostgresStimulationSchema (live Postgres)', () => {
    const prefix = `cnsmig_${Date.now().toString(36)}_`;
    let pool: Pool;

    const drop = () =>
        pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );

    beforeAll(() => {
        pool = new Pool({ connectionString: URL });
    });
    beforeEach(drop);
    afterAll(async () => {
        await drop();
        await pool.end();
    });

    it('installs through a pool and passes verify', async () => {
        await expect(CNSPostgresStimulationSchema.verify(pool, prefix)).rejects.toThrow('not installed');

        await CNSPostgresStimulationSchema.migrate(pool, prefix);

        await CNSPostgresStimulationSchema.verify(pool, prefix);
    });

    it('refuses the tables of an unversioned release', async () => {
        await pool.query(`CREATE TABLE ${prefix}stimulation (stimulation_id text PRIMARY KEY)`);

        await expect(CNSPostgresStimulationSchema.migrate(pool, prefix)).rejects.toThrow('exist without');
    });
});
