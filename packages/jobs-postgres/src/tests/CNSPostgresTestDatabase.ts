import { describe } from '@jest/globals';
import { Pool } from 'pg';
import { CNSPgJobDatabase } from '../database/CNSPgJobDatabase';
import { CNSPostgresJobSchema } from '../schema/CNSPostgresJobSchema';

export class CNSPostgresTestDatabase {
    static readonly url = process.env.DATABASE_URL;

    static describe(name: string, body: () => void): void {
        (CNSPostgresTestDatabase.url ? describe : describe.skip)(name, body);
    }

    readonly pool: Pool;
    readonly database: CNSPgJobDatabase;

    constructor(readonly tablePrefix: string) {
        this.pool = new Pool({ connectionString: CNSPostgresTestDatabase.url, max: 12 });
        this.database = new CNSPgJobDatabase(this.pool);
    }

    async migrate(): Promise<void> {
        await this.drop();
        await CNSPostgresJobSchema.migrate(this.database, this.tablePrefix);
    }

    async truncate(): Promise<void> {
        await this.pool.query(`TRUNCATE ${CNSPostgresJobSchema.tables(this.tablePrefix).join(', ')}`);
    }

    async drop(): Promise<void> {
        await this.pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresJobSchema.tables(this.tablePrefix), CNSPostgresJobSchema.migrationTable(this.tablePrefix)].join(', ')} CASCADE; DROP SEQUENCE IF EXISTS ${this.tablePrefix}job_seq`
        );
    }

    async end(): Promise<void> {
        await this.drop();
        await this.pool.end();
    }
}
