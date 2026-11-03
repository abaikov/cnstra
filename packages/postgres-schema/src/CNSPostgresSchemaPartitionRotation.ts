import type { ICNSPostgresSchemaConnection } from './interfaces/ICNSPostgresSchemaConnection';
import type { ICNSPostgresSchemaDatabase } from './interfaces/ICNSPostgresSchemaDatabase';
import type { TCNSPostgresSchemaPartitionRotationOptions } from './types/TCNSPostgresSchemaPartitionRotationOptions';

type TRangePartition = { readonly name: string; readonly from: number; readonly to: number };

export class CNSPostgresSchemaPartitionRotation {
    static readonly LOCK_NAMESPACE = 8;
    static readonly LOCK_TIMEOUT = '5s';
    static readonly DAY_MS = 24 * 60 * 60 * 1000;

    private readonly rotatedFor = new Map<string, string>();

    constructor(private readonly options: TCNSPostgresSchemaPartitionRotationOptions) {
        if (!(options.premakeDays >= 1) || !Number.isInteger(options.premakeDays)) {
            throw new Error(`[partition rotation] premakeDays must be a positive integer, got ${options.premakeDays}`);
        }
    }

    async rotate(
        database: ICNSPostgresSchemaDatabase,
        table: string,
        now: number,
        dropBefore: number,
        beforeDrop?: (connection: ICNSPostgresSchemaConnection, partition: string) => Promise<void>
    ): Promise<string[]> {
        const today = Math.floor(now / CNSPostgresSchemaPartitionRotation.DAY_MS);
        const days = `${today}:${Math.floor(dropBefore / CNSPostgresSchemaPartitionRotation.DAY_MS)}`;
        if (this.rotatedFor.get(table) === days) return [];
        const dropped = await this.underLock(database, table, async connection => {
            const expired = (await this.readRangePartitions(connection, table)).filter(partition => partition.to <= dropBefore);
            if (beforeDrop) for (const partition of expired) await beforeDrop(connection, partition.name);
            for (const partition of expired) await connection.query(`DROP TABLE ${partition.name}`);
            return expired.map(partition => partition.name);
        });
        await this.underLock(database, table, async connection => {
            const partitions = await this.readRangePartitions(connection, table);
            for (let ahead = 1; ahead <= this.options.premakeDays; ahead++) {
                const from = (today + ahead) * CNSPostgresSchemaPartitionRotation.DAY_MS;
                const to = from + CNSPostgresSchemaPartitionRotation.DAY_MS;
                if (partitions.some(partition => partition.from < to && from < partition.to)) continue;
                const name = `${table}_p${new Date(from).toISOString().slice(0, 10).replace(/-/g, '')}`;
                await connection.query(`CREATE TABLE ${name} (LIKE ${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
                await connection.query(`ALTER TABLE ${table} ATTACH PARTITION ${name} FOR VALUES FROM (${from}) TO (${to})`);
            }
        });
        this.rotatedFor.set(table, days);
        return dropped;
    }

    private underLock<TResult>(database: ICNSPostgresSchemaDatabase, table: string, work: (connection: ICNSPostgresSchemaConnection) => Promise<TResult>): Promise<TResult> {
        return database.transaction(async connection => {
            await connection.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CNSPostgresSchemaPartitionRotation.LOCK_NAMESPACE, table]);
            await connection.query(`SET LOCAL lock_timeout = '${CNSPostgresSchemaPartitionRotation.LOCK_TIMEOUT}'`);
            return work(connection);
        });
    }

    private async readRangePartitions(connection: ICNSPostgresSchemaConnection, table: string): Promise<TRangePartition[]> {
        const rows = await connection.query<{ name: string; bound: string }>(
            `SELECT child.oid::regclass::text AS name, pg_get_expr(child.relpartbound, child.oid) AS bound
             FROM pg_inherits
             JOIN pg_class child ON child.oid = pg_inherits.inhrelid
             WHERE pg_inherits.inhparent = $1::regclass`,
            [table]
        );
        const partitions: TRangePartition[] = [];
        for (const row of rows.rows) {
            const range = /^FOR VALUES FROM \('?(-?[\d.e+]+)'?\) TO \('?(-?[\d.e+]+)'?\)$/.exec(row.bound);
            if (range) partitions.push({ name: row.name, from: Number(range[1]), to: Number(range[2]) });
        }
        return partitions;
    }
}
