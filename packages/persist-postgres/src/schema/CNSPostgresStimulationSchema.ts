import { CNSPostgresSchemaMigrator, CNSPostgresSchemaPgDatabase } from '@cnstra/postgres-schema';
import type { ICNSPostgresSchemaConnection, ICNSPostgresSchemaPgPool } from '@cnstra/postgres-schema';
import type { Pool } from 'pg';
import type { ICNSPgQueryable } from '../interfaces/ICNSPgQueryable';
import type { TCNSPostgresStimulationMigrateOptions } from '../types/TCNSPostgresStimulationMigrateOptions';

export class CNSPostgresStimulationSchema {
    static readonly DEFAULT_TABLE_PREFIX = 'cns_';
    private static readonly LONGEST_SUFFIX = 'stimulation_attempt_started_idx';

    private static readonly migrator = new CNSPostgresSchemaMigrator({
        name: 'stimulation',
        tables: tablePrefix => CNSPostgresStimulationSchema.tables(tablePrefix),
        steps: [{ step: 1, kind: 'expand', sql: tablePrefix => CNSPostgresStimulationSchema.initialSql(tablePrefix) }],
    });

    static assertTablePrefix(tablePrefix: string): string {
        return CNSPostgresStimulationSchema.migrator.assertTablePrefix(tablePrefix, CNSPostgresStimulationSchema.LONGEST_SUFFIX);
    }

    static tables(tablePrefix: string = CNSPostgresStimulationSchema.DEFAULT_TABLE_PREFIX): string[] {
        const p = CNSPostgresStimulationSchema.assertTablePrefix(tablePrefix);
        return [`${p}stimulation`, `${p}stimulation_attempt`, `${p}stimulation_task`];
    }

    static migrationTable(tablePrefix: string = CNSPostgresStimulationSchema.DEFAULT_TABLE_PREFIX): string {
        return CNSPostgresStimulationSchema.migrator.migrationTable(CNSPostgresStimulationSchema.assertTablePrefix(tablePrefix));
    }

    static migrationSql(
        tablePrefix: string = CNSPostgresStimulationSchema.DEFAULT_TABLE_PREFIX,
        appliedSteps: readonly number[] = [],
        options?: TCNSPostgresStimulationMigrateOptions
    ): string {
        return CNSPostgresStimulationSchema.migrator.migrationSql(CNSPostgresStimulationSchema.assertTablePrefix(tablePrefix), appliedSteps, options);
    }

    static async migrate(
        pool: Pool,
        tablePrefix: string = CNSPostgresStimulationSchema.DEFAULT_TABLE_PREFIX,
        options?: TCNSPostgresStimulationMigrateOptions
    ): Promise<void> {
        await CNSPostgresStimulationSchema.migrator.migrate(
            CNSPostgresSchemaPgDatabase.fromPool(pool as unknown as ICNSPostgresSchemaPgPool),
            CNSPostgresStimulationSchema.assertTablePrefix(tablePrefix),
            options
        );
    }

    static async verify(database: ICNSPgQueryable, tablePrefix: string = CNSPostgresStimulationSchema.DEFAULT_TABLE_PREFIX): Promise<void> {
        await CNSPostgresStimulationSchema.migrator.verify(
            database as unknown as ICNSPostgresSchemaConnection,
            CNSPostgresStimulationSchema.assertTablePrefix(tablePrefix)
        );
    }

    private static initialSql(p: string): string {
        return `
CREATE TABLE ${p}stimulation (
    stimulation_id text PRIMARY KEY,
    entry jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
    scope_name text,
    progress jsonb NOT NULL,
    updated_at bigint NOT NULL,
    started_at bigint NOT NULL DEFAULT 0,
    hop_count int NOT NULL DEFAULT 0,
    last_completed_at bigint
) WITH (fillfactor = 70);
CREATE INDEX ${p}stimulation_started_idx ON ${p}stimulation (started_at DESC, stimulation_id COLLATE "C" DESC);
CREATE INDEX ${p}stimulation_scope_started_idx ON ${p}stimulation (scope_name, started_at DESC, stimulation_id COLLATE "C" DESC);

-- No foreign keys below: attempts and tasks arrive over separate writes, often before their parent row.
CREATE TABLE ${p}stimulation_attempt (
    stimulation_attempt_id text PRIMARY KEY,
    stimulation_id text NOT NULL,
    attempt_number int NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
    started_at bigint NOT NULL,
    completed_at bigint,
    hop_count int NOT NULL,
    has_error boolean NOT NULL,
    replay_of text,
    entry jsonb NOT NULL,
    UNIQUE (stimulation_id, attempt_number)
);
CREATE INDEX ${p}stimulation_attempt_started_idx ON ${p}stimulation_attempt (started_at);

CREATE TABLE ${p}stimulation_task (
    stimulation_attempt_id text NOT NULL,
    task_index int NOT NULL,
    neuron_name text NOT NULL,
    dendrite_collateral_name text NOT NULL,
    input_index int NOT NULL,
    output jsonb,
    status text NOT NULL CHECK (status IN ('done', 'failed')),
    error text,
    started_at bigint NOT NULL,
    duration_ms bigint,
    activation_context jsonb,
    PRIMARY KEY (stimulation_attempt_id, task_index, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE ${p}stimulation_task_default PARTITION OF ${p}stimulation_task DEFAULT;
`;
    }
}
