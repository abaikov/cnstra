import { Pool } from 'pg';
import { CNSPostgresSchemaPartitionRotation } from '../CNSPostgresSchemaPartitionRotation';
import { CNSPostgresSchemaPgDatabase } from '../CNSPostgresSchemaPgDatabase';

const url = process.env.DATABASE_URL;
const table = 'cns_rotation_test_event';
const DAY = CNSPostgresSchemaPartitionRotation.DAY_MS;
const partitionOf = (day: number) => `${table}_p${new Date(day * DAY).toISOString().slice(0, 10).replace(/-/g, '')}`;

(url ? describe : describe.skip)('CNSPostgresSchemaPartitionRotation', () => {
    const pool = new Pool({ connectionString: url, max: 4 });
    const database = CNSPostgresSchemaPgDatabase.fromPool(pool);
    const rotation = () => new CNSPostgresSchemaPartitionRotation({ premakeDays: 3 });

    const partitions = async () =>
        (
            await pool.query<{ name: string }>(
                'SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = $1::regclass ',
                [table]
            )
        ).rows.map(row => row.name).sort();

    beforeEach(async () => {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        await pool.query(`CREATE TABLE ${table} (at bigint NOT NULL) PARTITION BY RANGE (at)`);
        await pool.query(`CREATE TABLE ${table}_default PARTITION OF ${table} DEFAULT`);
    });
    afterAll(async () => {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        await pool.end();
    });

    it('attaches the days after today, so rows already in the default partition never block it', async () => {
        await pool.query(`INSERT INTO ${table} (at) VALUES ($1)`, [10.5 * DAY]);

        await rotation().rotate(database, table, 10.5 * DAY, 0);

        expect(await partitions()).toEqual([partitionOf(11), partitionOf(12), partitionOf(13), `${table}_default`].sort());
        await pool.query(`INSERT INTO ${table} (at) VALUES ($1)`, [12 * DAY - 1]);
        expect((await pool.query(`SELECT count(*)::int AS n FROM ${partitionOf(11)}`)).rows[0].n).toBe(1);
    });

    it('drops the days that end at or before dropBefore and leaves the default partition', async () => {
        await rotation().rotate(database, table, 10.5 * DAY, 0);

        const dropped = await rotation().rotate(database, table, 12.5 * DAY, 13 * DAY);

        expect(dropped.sort()).toEqual([partitionOf(11), partitionOf(12)].sort());
        expect(await partitions()).toEqual([partitionOf(13), partitionOf(14), partitionOf(15), `${table}_default`].sort());
    });

    it('skips a day that an existing partition already overlaps', async () => {
        await pool.query(`CREATE TABLE ${table}_wide PARTITION OF ${table} FOR VALUES FROM (${11.5 * DAY}) TO (${12.5 * DAY})`);

        await rotation().rotate(database, table, 10.5 * DAY, 0);

        expect(await partitions()).toEqual([partitionOf(13), `${table}_default`, `${table}_wide`].sort());
    });

    it('touches the catalog once a day per table, however often it is called', async () => {
        const daily = rotation();
        await daily.rotate(database, table, 10.5 * DAY, 0);
        await pool.query(`DROP TABLE ${partitionOf(12)}`);

        await daily.rotate(database, table, 10.9 * DAY, 0);
        expect(await partitions()).not.toContain(partitionOf(12));

        await daily.rotate(database, table, 11.5 * DAY, 0);
        expect(await partitions()).toContain(partitionOf(12));
    });

    it('waits for a replica that is rotating instead of failing on the partition it created', async () => {
        const replica = await pool.connect();
        await replica.query('BEGIN');
        await replica.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CNSPostgresSchemaPartitionRotation.LOCK_NAMESPACE, table]);
        await replica.query(`CREATE TABLE ${partitionOf(11)} (LIKE ${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
        const waiting = rotation().rotate(database, table, 10.5 * DAY, 0);
        await new Promise(resolve => setTimeout(resolve, 300));
        await replica.query(`ALTER TABLE ${table} ATTACH PARTITION ${partitionOf(11)} FOR VALUES FROM (${11 * DAY}) TO (${12 * DAY})`);
        await replica.query('COMMIT');
        replica.release();

        await waiting;
        expect(await partitions()).toEqual([partitionOf(11), partitionOf(12), partitionOf(13), `${table}_default`].sort());
    });
});

describe('CNSPostgresSchemaPartitionRotation options', () => {
    it('rejects a premake that is not a positive integer', () => {
        expect(() => new CNSPostgresSchemaPartitionRotation({ premakeDays: 0 })).toThrow('premakeDays');
        expect(() => new CNSPostgresSchemaPartitionRotation({ premakeDays: 0.5 })).toThrow('premakeDays');
    });
});
