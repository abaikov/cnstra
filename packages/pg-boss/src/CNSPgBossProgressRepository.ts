/**
 * Postgres-backed resume-progress store for pg-boss, keyed by the pg-boss **job id**.
 *
 * In pg-boss a run = stimulation = job (one entity), so the checkpoint is keyed by
 * `job.id`; there is no separate run store. pg-boss can't hold arbitrary per-hop
 * progress on its job row (its `Job` has data/output/signal but no mutable progress
 * field), so the frontier lives in its own table (`cns_pgboss_progress`, default) on
 * the same Postgres. One upserted row per key; dropped when the job completes.
 *
 * OPTIONAL: this is an opt-in export (`@cnstra/pg-boss/postgres-progress`) — importing
 * `@cnstra/pg-boss` (worker/enqueue) does NOT pull in `pg`. It's just one
 * `ICNSProgressRepository`; the progress store is independent of the broker, so you can
 * run pg-boss with `@cnstra/progress-redis` (or any impl) instead.
 */
import { Pool } from 'pg';
import type { ICNSProgressRepository } from '@cnstra/persist';
import type { TCNSProgress } from '@cnstra/persist-dto';
import { DEFAULT_TABLE, assertSafeTable, ensureSchema } from './migrate';

export interface TCNSPgBossProgressRepositoryOptions {
    /** Connection string (a Pool is created and owned by the repo). */
    connectionString?: string;
    /** Or inject an existing pg Pool (not closed by `close()`). */
    pool?: Pool;
    /** Table name (default `cns_pgboss_progress`). */
    table?: string;
    /** Lazily `ensureSchema` on first use (default true). Set false to manage migrations yourself. */
    autoMigrate?: boolean;
}

export class CNSPgBossProgressRepository implements ICNSProgressRepository {
    private readonly pool: Pool;
    private readonly ownsPool: boolean;
    private readonly table: string;
    private readonly autoMigrate: boolean;
    private ready: Promise<void> | undefined;

    constructor(opts: TCNSPgBossProgressRepositoryOptions) {
        if (opts.pool) {
            this.pool = opts.pool;
            this.ownsPool = false;
        } else if (opts.connectionString) {
            this.pool = new Pool({ connectionString: opts.connectionString });
            this.ownsPool = true;
        } else {
            throw new Error(
                '[@cnstra/pg-boss] CNSPgBossProgressRepository needs `connectionString` or `pool`'
            );
        }
        this.table = assertSafeTable(opts.table ?? DEFAULT_TABLE);
        this.autoMigrate = opts.autoMigrate ?? true;
    }

    private ensure(): Promise<void> {
        if (!this.autoMigrate) return Promise.resolve();
        return (this.ready ??= ensureSchema(this.pool, this.table));
    }

    async save(key: string, progress: TCNSProgress): Promise<void> {
        await this.ensure();
        await this.pool.query(
            `INSERT INTO ${this.table} (key, progress, updated_at)
             VALUES ($1, $2::jsonb, now())
             ON CONFLICT (key) DO UPDATE SET progress = EXCLUDED.progress, updated_at = now()`,
            [key, JSON.stringify(progress)]
        );
    }

    async load(key: string): Promise<TCNSProgress | undefined> {
        await this.ensure();
        const res = await this.pool.query<{ progress: TCNSProgress }>(
            `SELECT progress FROM ${this.table} WHERE key = $1`,
            [key]
        );
        return res.rows[0]?.progress;
    }

    async delete(key: string): Promise<void> {
        await this.ensure();
        await this.pool.query(`DELETE FROM ${this.table} WHERE key = $1`, [key]);
    }

    /**
     * Prune rows not touched for `olderThanMs` — the safety net for jobs that failed
     * PERMANENTLY (retries exhausted): their frontier row is never `delete`d (pg-boss
     * has no terminal-failure hook), so it would leak. A still-retrying job keeps its
     * `updated_at` fresh, so choose a threshold comfortably larger than your longest
     * retry backoff window and run this on a schedule. Returns the number of rows removed.
     */
    async deleteStale(olderThanMs: number): Promise<number> {
        await this.ensure();
        const res = await this.pool.query(
            `DELETE FROM ${this.table}
             WHERE updated_at < now() - ($1::bigint * interval '1 millisecond')`,
            [Math.max(0, Math.floor(olderThanMs))]
        );
        return res.rowCount ?? 0;
    }

    /** Close the owned pool (no-op when a pool was injected). */
    async close(): Promise<void> {
        if (this.ownsPool) await this.pool.end();
    }
}
