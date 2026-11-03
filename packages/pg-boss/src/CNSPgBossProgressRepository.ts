/**
 * Postgres-backed resume-progress store for pg-boss, keyed by the pg-boss **job id**.
 *
 * In pg-boss a run = stimulation = job (one entity), so the checkpoint is keyed by
 * `job.id`; there is no separate run store. pg-boss can't hold arbitrary per-hop
 * progress on its job row (its `Job` has data/output/signal but no mutable progress
 * field), so the frontier lives in its own table (`<tablePrefix>pgboss_progress`) on
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
import { CNSPgBossProgressSchema } from './schema/CNSPgBossProgressSchema';

export type TCNSPgBossProgressRepositoryOptions = {
    /** Connection string (a Pool is created and owned by the repo). */
    connectionString?: string;
    /** Or inject an existing pg Pool (not closed by `close()`). */
    pool?: Pool;
    /** Table name prefix (default `cns_`); the table is `<tablePrefix>pgboss_progress`. */
    tablePrefix?: string;
    /** Create or upgrade the table on first use (default true). Set false to manage migrations yourself. */
    autoMigrate?: boolean;
    now?: () => number;
};

export class CNSPgBossProgressRepository implements ICNSProgressRepository {
    private readonly pool: Pool;
    private readonly ownsPool: boolean;
    private readonly tablePrefix: string;
    private readonly table: string;
    private readonly autoMigrate: boolean;
    private readonly now: () => number;
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
        this.tablePrefix = CNSPgBossProgressSchema.assertTablePrefix(opts.tablePrefix ?? CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX);
        this.table = CNSPgBossProgressSchema.table(this.tablePrefix);
        this.autoMigrate = opts.autoMigrate ?? true;
        this.now = opts.now ?? Date.now;
    }

    private schemaReady(): Promise<void> {
        if (!this.autoMigrate) return Promise.resolve();
        this.ready ??= CNSPgBossProgressSchema.migrate(this.pool, this.tablePrefix).catch(error => {
            this.ready = undefined;
            throw error;
        });
        return this.ready;
    }

    async save(key: string, progress: TCNSProgress): Promise<void> {
        await this.schemaReady();
        await this.pool.query(
            `INSERT INTO ${this.table} (job_id, progress, updated_at)
             VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (job_id) DO UPDATE SET progress = EXCLUDED.progress, updated_at = EXCLUDED.updated_at`,
            [key, JSON.stringify(progress), this.now()]
        );
    }

    async load(key: string): Promise<TCNSProgress | undefined> {
        await this.schemaReady();
        const res = await this.pool.query<{ progress: TCNSProgress }>(
            `SELECT progress FROM ${this.table} WHERE job_id = $1`,
            [key]
        );
        return res.rows[0]?.progress;
    }

    async delete(key: string): Promise<void> {
        await this.schemaReady();
        await this.pool.query(`DELETE FROM ${this.table} WHERE job_id = $1`, [key]);
    }

    /**
     * Prune rows not touched for `olderThanMs` — the safety net for jobs that failed
     * PERMANENTLY (retries exhausted): their frontier row is never `delete`d (pg-boss
     * has no terminal-failure hook), so it would leak. A still-retrying job keeps its
     * `updated_at` fresh, so choose a threshold comfortably larger than your longest
     * retry backoff window and run this on a schedule. Returns the number of rows removed.
     */
    async deleteStale(olderThanMs: number): Promise<number> {
        await this.schemaReady();
        const res = await this.pool.query(
            `DELETE FROM ${this.table}
             WHERE updated_at < $1`,
            [this.now() - Math.max(0, Math.floor(olderThanMs))]
        );
        return res.rowCount ?? 0;
    }

    /** Close the owned pool (no-op when a pool was injected). */
    async close(): Promise<void> {
        if (this.ownsPool) await this.pool.end();
    }
}
