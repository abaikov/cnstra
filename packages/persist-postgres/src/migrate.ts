/**
 * Schema / migrations for the CNStra stimulation/attempt/task relational store.
 *
 * The package OWNS this schema — run it explicitly via `cnstra-persist-postgres migrate`
 * or `ensureSchema(db)`, or let the repository auto-create it on first use. Five tables
 * under a configurable prefix (default `cns_`); the stimulation's `progress` is
 * NORMALISED into `stimulation_frontier` (one row per outstanding task) +
 * `stimulation_context` (one row per neuron).
 */

/** Minimal pg client surface (a `pg` Pool or Client satisfies it). */
export interface IPgQueryable {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const DEFAULT_PREFIX = 'cns_';

/** Guard the table prefix (it is interpolated into DDL/DML, not parameterised). */
export function assertSafePrefix(prefix: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
        throw new Error(
            `[@cnstra/persist-postgres] unsafe table prefix: ${JSON.stringify(prefix)}`
        );
    }
    return prefix;
}

/** The full CREATE TABLE + CREATE INDEX DDL (idempotent). */
export function persistPostgresSchemaSql(prefix: string = DEFAULT_PREFIX): string {
    const p = assertSafePrefix(prefix);
    return `
CREATE TABLE IF NOT EXISTS ${p}stimulation (
    stimulation_id text PRIMARY KEY,
    entry jsonb NOT NULL,
    status text NOT NULL,
    scope_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${p}stimulation_updated_idx ON ${p}stimulation (updated_at DESC);
CREATE INDEX IF NOT EXISTS ${p}stimulation_scope_idx ON ${p}stimulation (scope_name);

CREATE TABLE IF NOT EXISTS ${p}stimulation_frontier (
    stimulation_id text NOT NULL REFERENCES ${p}stimulation(stimulation_id) ON DELETE CASCADE,
    ord int NOT NULL,
    neuron_name text NOT NULL,
    dendrite_collateral_name text NOT NULL,
    input jsonb,
    PRIMARY KEY (stimulation_id, ord)
);

CREATE TABLE IF NOT EXISTS ${p}stimulation_context (
    stimulation_id text NOT NULL REFERENCES ${p}stimulation(stimulation_id) ON DELETE CASCADE,
    neuron_name text NOT NULL,
    value jsonb NOT NULL,
    PRIMARY KEY (stimulation_id, neuron_name)
);

-- NOTE: no FK on stimulation_id — over the devtools wire the persistor's
-- saveStimulation and saveAttempt ride SEPARATE async batches processed
-- concurrently by the server, so an attempt insert can reach Postgres before its
-- stimulation row's transaction commits; a hard FK would reject it (23503). Same
-- exposure as ${p}task; delete() removes attempts explicitly instead of cascading.
CREATE TABLE IF NOT EXISTS ${p}stimulation_attempt (
    stimulation_attempt_id text PRIMARY KEY,
    stimulation_id text NOT NULL,
    attempt_number int NOT NULL,
    status text NOT NULL,
    started_at bigint NOT NULL,
    completed_at bigint,
    hop_count int NOT NULL,
    has_error boolean NOT NULL,
    replay_of text,
    entry jsonb NOT NULL,
    UNIQUE (stimulation_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS ${p}stimulation_attempt_idx ON ${p}stimulation_attempt (stimulation_id, attempt_number);

-- NOTE: no FK on stimulation_attempt_id — the persistor streams settled tasks
-- (appendTask) as hops complete, BEFORE the attempt marker is flushed (saveAttempt),
-- so a hard FK would reject the insert. delete() removes tasks explicitly instead.
CREATE TABLE IF NOT EXISTS ${p}task (
    stimulation_attempt_id text NOT NULL,
    "index" int NOT NULL,
    neuron_name text NOT NULL,
    dendrite_collateral_name text NOT NULL,
    input_index int NOT NULL,
    output jsonb,
    status text NOT NULL,
    error text,
    started_at bigint NOT NULL,
    duration int,
    PRIMARY KEY (stimulation_attempt_id, "index")
);
`;
}

/** Idempotently create all tables + indexes. Safe to run repeatedly. */
export async function ensureSchema(
    db: IPgQueryable,
    prefix: string = DEFAULT_PREFIX
): Promise<void> {
    await db.query(persistPostgresSchemaSql(prefix));
}
