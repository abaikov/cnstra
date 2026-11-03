import { CNSPostgresSchemaMigrator } from '@cnstra/postgres-schema';
import type { ICNSPostgresJobConnection } from '../interfaces/ICNSPostgresJobConnection';
import type { ICNSPostgresJobDatabase } from '../interfaces/ICNSPostgresJobDatabase';
import type { TCNSPostgresJobMigrateOptions } from '../types/TCNSPostgresJobMigrateOptions';

export class CNSPostgresJobSchema {
    static readonly DEFAULT_TABLE_PREFIX = 'cns_';
    private static readonly LONGEST_SUFFIX = 'job_history_final_status_check';

    private static readonly migrator = new CNSPostgresSchemaMigrator({
        name: 'job',
        tables: tablePrefix => [...CNSPostgresJobSchema.tables(tablePrefix), `${tablePrefix}job_seq`],
        steps: [{ step: 1, kind: 'expand', sql: tablePrefix => CNSPostgresJobSchema.initialSql(tablePrefix) }],
    });

    static assertTablePrefix(tablePrefix: string): string {
        return CNSPostgresJobSchema.migrator.assertTablePrefix(tablePrefix, CNSPostgresJobSchema.LONGEST_SUFFIX);
    }

    static tables(tablePrefix: string = CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX): string[] {
        const p = CNSPostgresJobSchema.assertTablePrefix(tablePrefix);
        return [`${p}job`, `${p}job_history`, `${p}job_type`, `${p}job_group_throttle`, `${p}job_log`, `${p}job_schedule`];
    }

    static migrationTable(tablePrefix: string = CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX): string {
        return CNSPostgresJobSchema.migrator.migrationTable(CNSPostgresJobSchema.assertTablePrefix(tablePrefix));
    }

    static migrationSql(
        tablePrefix: string = CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX,
        appliedSteps: readonly number[] = [],
        options?: TCNSPostgresJobMigrateOptions
    ): string {
        return CNSPostgresJobSchema.migrator.migrationSql(CNSPostgresJobSchema.assertTablePrefix(tablePrefix), appliedSteps, options);
    }

    static async migrate(
        database: ICNSPostgresJobDatabase,
        tablePrefix: string = CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX,
        options?: TCNSPostgresJobMigrateOptions
    ): Promise<void> {
        await CNSPostgresJobSchema.migrator.migrate(database, CNSPostgresJobSchema.assertTablePrefix(tablePrefix), options);
    }

    static async verify(connection: ICNSPostgresJobConnection, tablePrefix: string = CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX): Promise<void> {
        await CNSPostgresJobSchema.migrator.verify(connection, CNSPostgresJobSchema.assertTablePrefix(tablePrefix));
    }

    private static initialSql(p: string): string {
        return `
CREATE SEQUENCE ${p}job_seq;

CREATE TABLE ${p}job (
    job_id        text PRIMARY KEY,
    seq           bigint NOT NULL,
    job_type      text NOT NULL,
    payload       jsonb,
    meta          jsonb,
    retry         jsonb,
    job_key       text,
    job_group     text,
    priority      integer NOT NULL DEFAULT 0,
    run_after     double precision NOT NULL,
    created_at    double precision NOT NULL,
    attempts      jsonb NOT NULL DEFAULT '[]',
    locked_until  double precision,
    wait          text CONSTRAINT ${p}job_wait_check CHECK (wait IN ('scheduled', 'key', 'unchecked')),
    state         jsonb,
    enqueue_request jsonb
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.01, toast.autovacuum_vacuum_scale_factor = 0.01);

CREATE INDEX ${p}job_ready_idx ON ${p}job (job_type, priority DESC, run_after, seq) WHERE wait IS NULL AND locked_until IS NULL;
CREATE INDEX ${p}job_scheduled_idx ON ${p}job (run_after) WHERE wait = 'scheduled';
CREATE INDEX ${p}job_key_idx ON ${p}job (job_key, seq) WHERE job_key IS NOT NULL;
CREATE UNIQUE INDEX ${p}job_running_key_idx ON ${p}job (job_key) WHERE locked_until IS NOT NULL AND job_key IS NOT NULL;
CREATE INDEX ${p}job_unchecked_idx ON ${p}job (job_type) WHERE wait = 'unchecked';
CREATE INDEX ${p}job_running_idx ON ${p}job (job_type, job_group) WHERE locked_until IS NOT NULL;

CREATE TABLE ${p}job_history (
    job_id        text NOT NULL,
    job_type      text NOT NULL,
    payload       jsonb,
    meta          jsonb,
    retry         jsonb,
    job_key       text,
    job_group     text,
    priority      integer NOT NULL,
    created_at    double precision NOT NULL,
    attempts      jsonb NOT NULL,
    state         jsonb,
    finished_at   double precision NOT NULL,
    final_status  text NOT NULL CONSTRAINT ${p}job_history_final_status_check CHECK (final_status IN ('completed', 'failed', 'cancelled', 'superseded', 'expired'))
) PARTITION BY RANGE (finished_at);
CREATE TABLE ${p}job_history_default PARTITION OF ${p}job_history DEFAULT;

CREATE INDEX ${p}job_history_id_idx ON ${p}job_history (job_id);

CREATE INDEX ${p}job_history_key_idx ON ${p}job_history (job_type, job_key, finished_at) WHERE job_key IS NOT NULL;
CREATE INDEX ${p}job_history_status_idx ON ${p}job_history (job_type, final_status, finished_at);
CREATE INDEX ${p}job_history_finished_idx ON ${p}job_history (finished_at);

CREATE TABLE ${p}job_type (
    job_type      text PRIMARY KEY,
    meta          jsonb,
    registered    boolean NOT NULL DEFAULT false,
    next_start_at double precision
);

CREATE TABLE ${p}job_group_throttle (
    job_type      text NOT NULL,
    job_group     text NOT NULL,
    next_start_at double precision NOT NULL,
    PRIMARY KEY (job_type, job_group)
);

CREATE TABLE ${p}job_log (
    job_id         text NOT NULL,
    attempt_number integer NOT NULL,
    seq            integer NOT NULL,
    at             double precision NOT NULL,
    kind           text NOT NULL,
    entry          jsonb,
    PRIMARY KEY (job_id, attempt_number, seq, at)
);

CREATE TABLE ${p}job_schedule (
    schedule_id     text PRIMARY KEY,
    job_type        text NOT NULL,
    schedule        jsonb NOT NULL,
    from_definition boolean NOT NULL
);

CREATE INDEX ${p}job_schedule_type_idx ON ${p}job_schedule (job_type);
`;
    }
}
