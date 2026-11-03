import { CNSPostgresSchemaMigrator, CNSPostgresSchemaPgDatabase } from '@cnstra/postgres-schema';
import type { ICNSPostgresSchemaConnection, ICNSPostgresSchemaPgPool } from '@cnstra/postgres-schema';
import type { Pool } from 'pg';
import type { TCNSPgBossProgressMigrateOptions } from '../types/TCNSPgBossProgressMigrateOptions';

export class CNSPgBossProgressSchema {
    static readonly DEFAULT_TABLE_PREFIX = 'cns_';
    private static readonly LONGEST_SUFFIX = 'pgboss_progress_pkey';

    private static readonly migrator = new CNSPostgresSchemaMigrator({
        name: 'pgboss_progress',
        tables: tablePrefix => [CNSPgBossProgressSchema.table(tablePrefix)],
        steps: [
            {
                step: 1,
                kind: 'expand',
                sql: p => `
CREATE TABLE ${p}pgboss_progress (
    job_id text PRIMARY KEY,
    progress jsonb NOT NULL,
    updated_at bigint NOT NULL
);
`,
            },
        ],
    });

    static assertTablePrefix(tablePrefix: string): string {
        return CNSPgBossProgressSchema.migrator.assertTablePrefix(tablePrefix, CNSPgBossProgressSchema.LONGEST_SUFFIX);
    }

    static table(tablePrefix: string = CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX): string {
        return `${CNSPgBossProgressSchema.assertTablePrefix(tablePrefix)}pgboss_progress`;
    }

    static migrationTable(tablePrefix: string = CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX): string {
        return CNSPgBossProgressSchema.migrator.migrationTable(CNSPgBossProgressSchema.assertTablePrefix(tablePrefix));
    }

    static migrationSql(
        tablePrefix: string = CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX,
        appliedSteps: readonly number[] = [],
        options?: TCNSPgBossProgressMigrateOptions
    ): string {
        return CNSPgBossProgressSchema.migrator.migrationSql(CNSPgBossProgressSchema.assertTablePrefix(tablePrefix), appliedSteps, options);
    }

    static async migrate(
        pool: Pool,
        tablePrefix: string = CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX,
        options?: TCNSPgBossProgressMigrateOptions
    ): Promise<void> {
        await CNSPgBossProgressSchema.migrator.migrate(
            CNSPostgresSchemaPgDatabase.fromPool(pool as unknown as ICNSPostgresSchemaPgPool),
            CNSPgBossProgressSchema.assertTablePrefix(tablePrefix),
            options
        );
    }

    static async verify(pool: Pool, tablePrefix: string = CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX): Promise<void> {
        await CNSPgBossProgressSchema.migrator.verify(
            pool as unknown as ICNSPostgresSchemaConnection,
            CNSPgBossProgressSchema.assertTablePrefix(tablePrefix)
        );
    }
}
