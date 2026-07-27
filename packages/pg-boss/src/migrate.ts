/**
 * Schema / migrations for the pg-boss progress table (`cns_pgboss_progress`).
 *
 * The package OWNS this schema so you can manage it explicitly (a migration step in
 * your own tooling) instead of relying on the repository's lazy auto-create. Run it
 * via the `cnstra-pgboss-progress migrate` CLI, or call `ensureSchema(db)` yourself
 * with any pg client/pool.
 */

/** Minimal pg client surface (a `pg` Pool or Client satisfies it). */
export interface IPgQueryable {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const DEFAULT_TABLE = 'cns_pgboss_progress';

/** Guard the table identifier (it is interpolated into DDL/DML, not parameterised). */
export function assertSafeTable(table: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error(
            `[@cnstra/pg-boss] unsafe progress table name: ${JSON.stringify(table)}`
        );
    }
    return table;
}

/** The CREATE TABLE for the progress store. One upserted row per key (job id). */
export function pgBossProgressSchemaSql(table: string = DEFAULT_TABLE): string {
    assertSafeTable(table);
    // `updated_at` + its index back `deleteStale()`: a row is deleted when its job
    // succeeds, but a job that fails PERMANENTLY (retries exhausted) leaves its row —
    // pg-boss has no terminal-failure hook to key off. Pruning by staleness collects
    // those, and the index keeps the sweep cheap.
    return `CREATE TABLE IF NOT EXISTS ${table} (
    key text PRIMARY KEY,
    progress jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`;
}

/** Idempotently create the progress table. Safe to run repeatedly. */
export async function ensureSchema(
    db: IPgQueryable,
    table: string = DEFAULT_TABLE
): Promise<void> {
    await db.query(pgBossProgressSchemaSql(table));
}
