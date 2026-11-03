import type { ICNSPostgresSchemaConnection } from './interfaces/ICNSPostgresSchemaConnection';
import type { ICNSPostgresSchemaDatabase } from './interfaces/ICNSPostgresSchemaDatabase';
import type { ICNSPostgresSchemaPgPool } from './interfaces/ICNSPostgresSchemaPgPool';

export class CNSPostgresSchemaPgDatabase implements ICNSPostgresSchemaDatabase {
    private constructor(
        private readonly open: () => Promise<{ connection: ICNSPostgresSchemaConnection; release: (error?: Error) => void }>
    ) {}

    static fromPool(pool: ICNSPostgresSchemaPgPool): CNSPostgresSchemaPgDatabase {
        return new CNSPostgresSchemaPgDatabase(async () => {
            const client = await pool.connect();
            return { connection: client, release: error => client.release(error) };
        });
    }

    async transaction<TResult>(work: (connection: ICNSPostgresSchemaConnection) => Promise<TResult>): Promise<TResult> {
        const { connection, release } = await this.open();
        try {
            await connection.query('BEGIN');
            const result = await work(connection);
            await connection.query('COMMIT');
            release();
            return result;
        } catch (error) {
            const rollback = await connection.query('ROLLBACK').then(
                () => undefined,
                (rollbackError: unknown) => rollbackError
            );
            release(rollback instanceof Error ? rollback : undefined);
            throw error;
        }
    }
}
