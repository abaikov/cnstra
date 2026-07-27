/**
 * Opt-in Postgres progress store for pg-boss — import from
 * `@cnstra/pg-boss/postgres-progress` (this subpath pulls in `pg`; the main
 * `@cnstra/pg-boss` entry does not).
 */
export {
    CNSPgBossProgressRepository,
    type TCNSPgBossProgressRepositoryOptions,
} from './CNSPgBossProgressRepository';
export {
    ensureSchema,
    pgBossProgressSchemaSql,
    assertSafeTable,
    DEFAULT_TABLE,
    type IPgQueryable,
} from './migrate';
