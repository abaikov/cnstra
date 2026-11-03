import { Pool } from 'pg';
import { CNSPostgresSchemaMigrator } from '../CNSPostgresSchemaMigrator';
import { CNSPostgresSchemaPgDatabase } from '../CNSPostgresSchemaPgDatabase';
import type { TCNSPostgresSchemaStep } from '../types/TCNSPostgresSchemaStep';

const url = process.env.DATABASE_URL;
const prefix = 'cns_schema_test_';

const createItems: TCNSPostgresSchemaStep = {
    step: 1,
    kind: 'expand',
    sql: p => `CREATE TABLE ${p}item (id text PRIMARY KEY, legacy text);`,
};
const addTitle: TCNSPostgresSchemaStep = {
    step: 2,
    kind: 'expand',
    sql: p => `ALTER TABLE ${p}item ADD COLUMN title text;`,
};
const dropLegacy: TCNSPostgresSchemaStep = {
    step: 3,
    kind: 'contract',
    sql: p => `ALTER TABLE ${p}item DROP COLUMN legacy;`,
};
const addRank: TCNSPostgresSchemaStep = {
    step: 4,
    kind: 'expand',
    sql: p => `ALTER TABLE ${p}item ADD COLUMN rank integer;`,
};

const migratorOf = (...steps: TCNSPostgresSchemaStep[]) =>
    new CNSPostgresSchemaMigrator({ name: 'item', steps, tables: p => [`${p}item`] });

(url ? describe : describe.skip)('CNSPostgresSchemaMigrator', () => {
    const pool = new Pool({ connectionString: url, max: 4 });
    const database = CNSPostgresSchemaPgDatabase.fromPool(pool);

    const drop = () => pool.query(`DROP TABLE IF EXISTS ${prefix}item, ${prefix}item_migration`);
    const columns = async () =>
        (
            await pool.query<{ column_name: string }>(
                'SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name',
                [`${prefix}item`]
            )
        ).rows.map(row => row.column_name);
    const applied = async () =>
        (await pool.query<{ step: number }>(`SELECT step FROM ${prefix}item_migration ORDER BY step`)).rows.map(row => row.step);

    beforeEach(drop);
    afterAll(async () => {
        await drop();
        await pool.end();
    });

    it('installs every step on an empty database, contract steps included, and records them', async () => {
        await migratorOf(createItems, addTitle, dropLegacy).migrate(database, prefix);

        expect(await columns()).toEqual(['id', 'title']);
        expect(await applied()).toEqual([1, 2, 3]);
        await migratorOf(createItems, addTitle, dropLegacy).verify(pool, prefix);
    });

    it('applies only the expand steps of an upgrade, and the contract step when asked', async () => {
        await migratorOf(createItems).migrate(database, prefix);
        const upgraded = migratorOf(createItems, addTitle, dropLegacy, addRank);

        await upgraded.migrate(database, prefix);
        expect(await columns()).toEqual(['id', 'legacy', 'rank', 'title']);
        expect(await applied()).toEqual([1, 2, 4]);
        await upgraded.verify(pool, prefix);

        await upgraded.migrate(database, prefix, { contract: true });
        expect(await columns()).toEqual(['id', 'rank', 'title']);
        expect(await applied()).toEqual([1, 2, 3, 4]);
    });

    it('does nothing the second time', async () => {
        await migratorOf(createItems, addTitle).migrate(database, prefix);
        await migratorOf(createItems, addTitle).migrate(database, prefix);

        expect(await applied()).toEqual([1, 2]);
    });

    it('lets old code run on an expanded schema and stops it once a contract step it does not know is applied', async () => {
        await migratorOf(createItems, addTitle, dropLegacy).migrate(database, prefix);
        await expect(migratorOf(createItems).verify(pool, prefix)).rejects.toThrow('contract steps 3');

        await drop();
        await migratorOf(createItems, addTitle).migrate(database, prefix);
        await migratorOf(createItems).verify(pool, prefix);
    });

    it('refuses to start before the schema is installed or upgraded', async () => {
        await expect(migratorOf(createItems).verify(pool, prefix)).rejects.toThrow('not installed');
        await migratorOf(createItems).migrate(database, prefix);
        await expect(migratorOf(createItems, addTitle).verify(pool, prefix)).rejects.toThrow('steps 2 are not applied');
    });

    it('refuses tables that exist without the migration table', async () => {
        await pool.query(`CREATE TABLE ${prefix}item (id text PRIMARY KEY)`);

        await expect(migratorOf(createItems).migrate(database, prefix)).rejects.toThrow('exist without');
    });

    it('serialises concurrent migrations', async () => {
        const migrator = migratorOf(createItems, addTitle);

        await Promise.all([migrator.migrate(database, prefix), migrator.migrate(database, prefix), migrator.migrate(database, prefix)]);

        expect(await applied()).toEqual([1, 2]);
    });

    it('waits for a migration that holds the lock longer than the DDL lock timeout', async () => {
        const holder = await pool.connect();
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CNSPostgresSchemaMigrator.LOCK_NAMESPACE, `${prefix}item`]);
        const waiting = migratorOf(createItems).migrate(database, prefix);
        await new Promise(resolve => setTimeout(resolve, 6000));
        await holder.query('COMMIT');
        holder.release();

        await waiting;
        expect(await applied()).toEqual([1]);
    }, 20000);

    it('hands out the SQL of the missing steps, recording rows the next migrate reads', async () => {
        const migrator = migratorOf(createItems, addTitle, dropLegacy);
        await pool.query(migrator.migrationSql(prefix));
        await migrator.migrate(database, prefix);

        expect(await applied()).toEqual([1, 2, 3]);
        expect(migratorOf(createItems, addTitle, dropLegacy, addRank).migrationSql(prefix, [1, 2, 3])).toBe(
            `ALTER TABLE ${prefix}item ADD COLUMN rank integer;\nINSERT INTO ${prefix}item_migration (step, kind) VALUES (4, 'expand');`
        );
    });
});

describe('CNSPostgresSchemaMigrator steps and prefixes', () => {
    it('rejects steps that are not numbered from 1 without gaps', () => {
        expect(() => migratorOf(createItems, addRank)).toThrow('numbered 1, 2, 3');
    });

    it('caps the table prefix so the longest name fits in 63 bytes', () => {
        const migrator = migratorOf(createItems);
        const suffix = 'x'.repeat(40);

        expect(migrator.assertTablePrefix('a'.repeat(23), suffix)).toHaveLength(23);
        expect(() => migrator.assertTablePrefix('a'.repeat(24), suffix)).toThrow('at most 23 characters');
        expect(() => migrator.assertTablePrefix('bad-prefix', suffix)).toThrow('unsafe table prefix');
    });
});
