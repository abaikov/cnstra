/**
 * Postgres relational store for the CNStra stimulation/attempt/task durable model
 * (`ICNSStimulationRepository`). The stimulation's `progress` is NORMALISED: the
 * outstanding frontier into `<prefix>stimulation_frontier` (one row per task) and
 * per-neuron context into `<prefix>stimulation_context` — rebuilt into `TCNSProgress`
 * on read.
 *
 * Reuses the `IPgQueryable` seam so `pg` is an optional peer: inject any pg
 * client/pool, or pass a `connectionString` for the repo to own a Pool. Behaviourally
 * matches `CNSInMemoryStimulationRepository` (listStimulations newest-first, getAttempts
 * by attemptNumber, getTasks by index, delete cascades).
 */
import { Pool } from 'pg';
import type {
    ICNSStimulationRepository,
    ICNSStimulationRosterQuery,
    TCNSRosterEntry,
} from '@cnstra/persist';
import { computeRosterFacets, encodeRosterCursor } from '@cnstra/persist';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSProgress,
    TCNSPlannedTaskJSON,
    TCNSSignalJSON,
    ECNSStimulationStatus,
    ECNSStimulationTaskStatus,
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterRow,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterFacets,
} from '@cnstra/persist-dto';
import {
    DEFAULT_PREFIX,
    assertSafePrefix,
    ensureSchema,
    type IPgQueryable,
} from './migrate';

export interface TCNSPostgresStimulationRepositoryOptions {
    connectionString?: string;
    /** Inject an existing pg Pool (transactions supported; not closed by `close()`). */
    pool?: Pool;
    /** Inject any queryable (reads + best-effort non-transactional writes). */
    queryable?: IPgQueryable;
    /** Table prefix (default `cns_`). */
    tablePrefix?: string;
    /** Lazily ensure the schema on first use (default true). */
    autoMigrate?: boolean;
}

const j = (v: unknown): string => JSON.stringify(v ?? null);
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export class CNSPostgresStimulationRepository
    implements ICNSStimulationRepository, ICNSStimulationRosterQuery
{
    private readonly db: IPgQueryable;
    private readonly pool?: Pool;
    private readonly ownsPool: boolean;
    private readonly p: string;
    private readonly autoMigrate: boolean;
    private ready: Promise<void> | undefined;

    constructor(opts: TCNSPostgresStimulationRepositoryOptions) {
        if (opts.pool) {
            this.pool = opts.pool;
            this.db = opts.pool;
            this.ownsPool = false;
        } else if (opts.connectionString) {
            this.pool = new Pool({ connectionString: opts.connectionString });
            this.db = this.pool;
            this.ownsPool = true;
        } else if (opts.queryable) {
            this.db = opts.queryable;
            this.ownsPool = false;
        } else {
            throw new Error(
                '[@cnstra/persist-postgres] needs `connectionString`, `pool`, or `queryable`'
            );
        }
        this.p = assertSafePrefix(opts.tablePrefix ?? DEFAULT_PREFIX);
        this.autoMigrate = opts.autoMigrate ?? true;
    }

    private ensure(): Promise<void> {
        if (!this.autoMigrate) return Promise.resolve();
        return (this.ready ??= ensureSchema(this.db, this.p));
    }

    /** Run `fn` in a transaction when a Pool is available; else best-effort inline. */
    private async tx<T>(fn: (db: IPgQueryable) => Promise<T>): Promise<T> {
        if (!this.pool) return fn(this.db);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const out = await fn(client as unknown as IPgQueryable);
            await client.query('COMMIT');
            return out;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    // ── write ──

    async saveStimulation(s: TCNSStimulationState): Promise<void> {
        await this.ensure();
        const { p } = this;
        await this.tx(async db => {
            await db.query(
                `INSERT INTO ${p}stimulation (stimulation_id, entry, status, scope_name, updated_at)
                 VALUES ($1, $2::jsonb, $3, $4, now())
                 ON CONFLICT (stimulation_id)
                 DO UPDATE SET entry = EXCLUDED.entry, status = EXCLUDED.status,
                    scope_name = EXCLUDED.scope_name, updated_at = now()`,
                [s.stimulationId, j(s.entry), s.status, s.scopeName ?? null]
            );
            // Replace the normalised frontier.
            await db.query(
                `DELETE FROM ${p}stimulation_frontier WHERE stimulation_id = $1`,
                [s.stimulationId]
            );
            for (let i = 0; i < s.progress.tasks.length; i++) {
                const t = s.progress.tasks[i];
                await db.query(
                    `INSERT INTO ${p}stimulation_frontier
                        (stimulation_id, ord, neuron_name, dendrite_collateral_name, input)
                     VALUES ($1, $2, $3, $4, $5::jsonb)`,
                    [
                        s.stimulationId,
                        i,
                        t.neuronName,
                        t.dendriteCollateralName,
                        t.input ? j(t.input) : null,
                    ]
                );
            }
            // Replace the normalised context.
            await db.query(
                `DELETE FROM ${p}stimulation_context WHERE stimulation_id = $1`,
                [s.stimulationId]
            );
            for (const [neuronName, value] of Object.entries(
                s.progress.context
            )) {
                await db.query(
                    `INSERT INTO ${p}stimulation_context (stimulation_id, neuron_name, value)
                     VALUES ($1, $2, $3::jsonb)`,
                    [s.stimulationId, neuronName, j(value)]
                );
            }
        });
    }

    async saveAttempt(a: TCNSStimulationAttempt): Promise<void> {
        await this.ensure();
        const { p } = this;
        await this.db.query(
            `INSERT INTO ${p}stimulation_attempt
                (stimulation_attempt_id, stimulation_id, attempt_number, status, started_at,
                 completed_at, hop_count, has_error, replay_of, entry)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
             ON CONFLICT (stimulation_attempt_id) DO UPDATE SET
                status = EXCLUDED.status, completed_at = EXCLUDED.completed_at,
                hop_count = EXCLUDED.hop_count, has_error = EXCLUDED.has_error,
                replay_of = EXCLUDED.replay_of, entry = EXCLUDED.entry`,
            [
                a.stimulationAttemptId,
                a.stimulationId,
                a.attemptNumber,
                a.status,
                a.startedAt,
                a.completedAt,
                a.hopCount,
                a.hasError,
                a.replayOf,
                j(a.entry),
            ]
        );
    }

    async appendTask(t: TCNSStimulationTask): Promise<void> {
        await this.ensure();
        const { p } = this;
        await this.db.query(
            `INSERT INTO ${p}task
                (stimulation_attempt_id, "index", neuron_name, dendrite_collateral_name,
                 input_index, output, status, error, started_at, duration)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
             ON CONFLICT (stimulation_attempt_id, "index") DO NOTHING`,
            [
                t.stimulationAttemptId,
                t.index,
                t.neuronName,
                t.dendriteCollateralName,
                t.inputIndex,
                t.output ? j(t.output) : null,
                t.status,
                t.error,
                t.startedAt,
                t.duration,
            ]
        );
    }

    // ── read ──

    async getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationState | undefined> {
        await this.ensure();
        const { p } = this;
        const stimRes = await this.db.query(
            `SELECT entry, status, scope_name FROM ${p}stimulation WHERE stimulation_id = $1`,
            [stimulationId]
        );
        const row = stimRes.rows[0] as
            | {
                  entry: TCNSSignalJSON;
                  status: ECNSStimulationStatus;
                  scope_name: string | null;
              }
            | undefined;
        if (!row) return undefined;
        const [frontier, context] = await Promise.all([
            this.db.query(
                `SELECT ord, neuron_name, dendrite_collateral_name, input
                 FROM ${p}stimulation_frontier WHERE stimulation_id = $1 ORDER BY ord`,
                [stimulationId]
            ),
            this.db.query(
                `SELECT neuron_name, value FROM ${p}stimulation_context WHERE stimulation_id = $1`,
                [stimulationId]
            ),
        ]);
        return {
            stimulationId,
            entry: row.entry,
            status: row.status,
            progress: this.buildProgress(
                frontier.rows as TFrontierRow[],
                context.rows as TContextRow[]
            ),
            ...(row.scope_name != null ? { scopeName: row.scope_name } : {}),
        };
    }

    async listStimulations(filter?: {
        scopeName?: string;
    }): Promise<TCNSStimulationState[]> {
        await this.ensure();
        const { p } = this;
        const scope = filter?.scopeName ?? null;
        const stimsRes = await this.db.query(
            `SELECT stimulation_id, entry, status, scope_name FROM ${p}stimulation
             WHERE ($1::text IS NULL OR scope_name = $1)
             ORDER BY updated_at DESC`,
            [scope]
        );
        const stims = stimsRes.rows as TStimulationRow[];
        if (stims.length === 0) return [];
        const ids = stims.map(r => r.stimulation_id);
        const [frontierRes, contextRes] = await Promise.all([
            this.db.query(
                `SELECT stimulation_id, ord, neuron_name, dendrite_collateral_name, input
                 FROM ${p}stimulation_frontier WHERE stimulation_id = ANY($1) ORDER BY stimulation_id, ord`,
                [ids]
            ),
            this.db.query(
                `SELECT stimulation_id, neuron_name, value
                 FROM ${p}stimulation_context WHERE stimulation_id = ANY($1)`,
                [ids]
            ),
        ]);
        const frontierBy = groupBy(
            frontierRes.rows as TFrontierRow[],
            r => r.stimulation_id
        );
        const contextBy = groupBy(
            contextRes.rows as TContextRow[],
            r => r.stimulation_id
        );
        return stims.map(r => ({
            stimulationId: r.stimulation_id,
            entry: r.entry,
            status: r.status,
            progress: this.buildProgress(
                frontierBy.get(r.stimulation_id) ?? [],
                contextBy.get(r.stimulation_id) ?? []
            ),
            ...(r.scope_name != null ? { scopeName: r.scope_name } : {}),
        }));
    }

    async getAttempts(
        stimulationId: string
    ): Promise<TCNSStimulationAttempt[]> {
        await this.ensure();
        const { p } = this;
        const res = await this.db.query(
            `SELECT * FROM ${p}stimulation_attempt WHERE stimulation_id = $1 ORDER BY attempt_number`,
            [stimulationId]
        );
        return (res.rows as TAttemptRow[]).map(rowToAttempt);
    }

    async getTasks(
        stimulationAttemptId: string
    ): Promise<TCNSStimulationTask[]> {
        await this.ensure();
        const { p } = this;
        const res = await this.db.query(
            `SELECT * FROM ${p}task WHERE stimulation_attempt_id = $1 ORDER BY "index"`,
            [stimulationAttemptId]
        );
        return (res.rows as TTaskRow[]).map(rowToTask);
    }

    // ── roster query capability (filter + keyset + facets pushed into SQL) ──

    /**
     * Derive every filtered roster row in one CTE: `startedAt` = MIN(attempt),
     * `completedAt` = the latest attempt's, `hopCount` = SUM, `hasError` from
     * status, and the DISTINCT activated neuron names (for the neurons lens +
     * filter). Newest-first (`startedAt DESC, stimulationId DESC`) so the keyset
     * cursor is stable. `limit` is applied only when paginating (roster); facets
     * pull the whole filtered set.
     */
    private async selectRoster(
        filter: TCNSStimulationRosterFilter,
        opts?: { cursor?: string; limit?: number }
    ): Promise<{ entries: TCNSRosterEntry[]; total: number }> {
        await this.ensure();
        const { p } = this;
        // Decode the keyset cursor → the (startedAt, stimulationId) to page past.
        let curStarted: number | null = null;
        let curId: string | null = null;
        if (opts?.cursor) {
            const [ts, id] = Buffer.from(opts.cursor, 'base64')
                .toString('utf8')
                .split('|');
            curStarted = Number(ts);
            curId = id ?? '';
        }
        const params: unknown[] = [
            filter.scopeName ?? null,
            filter.status ?? null,
            filter.entryCollateralName ?? null,
            filter.neuronName ?? null,
            filter.text ? filter.text.toLowerCase() : null,
            filter.since ?? null,
            filter.until ?? null,
            curStarted,
            curId,
        ];
        const limitClause =
            opts?.limit != null ? ` LIMIT ${Math.max(0, opts.limit | 0)}` : '';
        const sql = `
            WITH agg AS (
                SELECT a.stimulation_id,
                       MIN(a.started_at) AS started_at,
                       SUM(a.hop_count)  AS hop_count,
                       (ARRAY_AGG(a.completed_at ORDER BY a.attempt_number DESC))[1] AS last_completed_at
                FROM ${p}stimulation_attempt a
                GROUP BY a.stimulation_id
            ),
            neu AS (
                SELECT ta.stimulation_id,
                       ARRAY_AGG(DISTINCT t.neuron_name) AS neurons
                FROM ${p}task t
                JOIN ${p}stimulation_attempt ta
                     ON ta.stimulation_attempt_id = t.stimulation_attempt_id
                GROUP BY ta.stimulation_id
            ),
            roster AS (
                SELECT s.stimulation_id, s.entry, s.status, s.scope_name,
                       COALESCE(agg.started_at, 0) AS started_at,
                       CASE WHEN s.status = 'running' THEN NULL
                            ELSE agg.last_completed_at END AS completed_at,
                       COALESCE(agg.hop_count, 0) AS hop_count,
                       (s.status = 'failed') AS has_error,
                       COALESCE(neu.neurons, ARRAY[]::text[]) AS neurons
                FROM ${p}stimulation s
                LEFT JOIN agg ON agg.stimulation_id = s.stimulation_id
                LEFT JOIN neu ON neu.stimulation_id = s.stimulation_id
            )
            SELECT *, COUNT(*) OVER() AS total_count FROM roster
            WHERE ($1::text IS NULL OR scope_name = $1)
              AND ($2::text IS NULL OR status = $2)
              AND ($3::text IS NULL OR entry->>'collateralName' = $3)
              AND ($4::text IS NULL OR $4 = ANY(neurons))
              AND ($5::text IS NULL OR lower(stimulation_id) LIKE '%'||$5||'%')
              AND ($6::bigint IS NULL OR started_at >= $6)
              AND ($7::bigint IS NULL OR started_at <= $7)
              AND ($8::bigint IS NULL OR (started_at, stimulation_id) < ($8, $9))
            ORDER BY started_at DESC, stimulation_id DESC${limitClause}`;
        const res = await this.db.query(sql, params);
        const rows = res.rows as TRosterRow[];
        const total = rows.length ? Number(rows[0].total_count) : 0;
        const entries: TCNSRosterEntry[] = rows.map(r => ({
            row: {
                stimulationId: r.stimulation_id,
                scopeName: r.scope_name ?? undefined,
                entry: r.entry as TCNSSignalJSON,
                status: r.status,
                startedAt: Number(r.started_at),
                completedAt: r.completed_at == null ? null : Number(r.completed_at),
                hopCount: Number(r.hop_count),
                hasError: r.has_error,
            },
            neurons: r.neurons ?? [],
        }));
        return { entries, total };
    }

    async queryRoster(
        filter: TCNSStimulationRosterFilter,
        opts: { cursor?: string; limit: number }
    ): Promise<TCNSStimulationRosterPage> {
        const { entries, total } = await this.selectRoster(filter, opts);
        const rows: TCNSStimulationRosterRow[] = entries.map(e => e.row);
        const lastRow = rows[rows.length - 1];
        // A full page implies there may be more; the window `total` is authoritative.
        const hasMore = rows.length >= opts.limit && rows.length < total;
        return {
            rows,
            nextCursor: hasMore && lastRow ? encodeRosterCursor(lastRow) : null,
            total,
        };
    }

    async queryFacets(
        filter: TCNSStimulationRosterFilter,
        opts?: { metricPath?: string }
    ): Promise<TCNSStimulationRosterFacets> {
        // Filter is pushed into SQL; the small GROUP-BY tally + histogram reuse the
        // shared reference aggregation so counts match the in-memory store exactly.
        const { entries } = await this.selectRoster(filter);
        return computeRosterFacets(entries, opts);
    }

    // ── lifecycle ──

    async delete(stimulationId: string): Promise<void> {
        await this.ensure();
        const { p } = this;
        await this.tx(async db => {
            // tasks + attempts have no FK (see migrate.ts) → delete them explicitly,
            // tasks first (they reference attempt ids), then the attempts.
            await db.query(
                `DELETE FROM ${p}task WHERE stimulation_attempt_id IN
                    (SELECT stimulation_attempt_id FROM ${p}stimulation_attempt WHERE stimulation_id = $1)`,
                [stimulationId]
            );
            await db.query(
                `DELETE FROM ${p}stimulation_attempt WHERE stimulation_id = $1`,
                [stimulationId]
            );
            // FK ON DELETE CASCADE removes frontier/context.
            await db.query(
                `DELETE FROM ${p}stimulation WHERE stimulation_id = $1`,
                [stimulationId]
            );
        });
    }

    /**
     * Retention: prune stimulations not updated for `olderThanMs` (with their
     * attempts/tasks/frontier/context). A run's `updated_at` stops advancing once it
     * settles, so old finished runs age out while an active one stays fresh — the same
     * semantics as the in-memory store's `ttlMs` and the pg-boss checkpoint's
     * `deleteStale`. Run it on a schedule (cron). Returns the number removed.
     */
    async deleteStale(olderThanMs: number): Promise<number> {
        await this.ensure();
        const { p } = this;
        const params = [Math.max(0, Math.floor(olderThanMs))];
        const cond = `updated_at < now() - ($1::bigint * interval '1 millisecond')`;
        const staleIds = `SELECT stimulation_id FROM ${p}stimulation WHERE ${cond}`;
        return this.tx(async db => {
            // tasks + attempts have no FK → delete explicitly (tasks first), then the
            // stimulations (FK cascade removes frontier/context).
            await db.query(
                `DELETE FROM ${p}task WHERE stimulation_attempt_id IN
                    (SELECT stimulation_attempt_id FROM ${p}stimulation_attempt
                     WHERE stimulation_id IN (${staleIds}))`,
                params
            );
            await db.query(
                `DELETE FROM ${p}stimulation_attempt WHERE stimulation_id IN (${staleIds})`,
                params
            );
            const res = await db.query(
                `DELETE FROM ${p}stimulation WHERE ${cond} RETURNING stimulation_id`,
                params
            );
            return res.rows.length;
        });
    }

    async close(): Promise<void> {
        if (this.ownsPool && this.pool) await this.pool.end();
    }

    // ── helpers ──

    private buildProgress(
        frontier: TFrontierRow[],
        context: TContextRow[]
    ): TCNSProgress {
        const tasks: TCNSPlannedTaskJSON[] = [...frontier]
            .sort((a, b) => a.ord - b.ord)
            .map(f => ({
                neuronName: f.neuron_name,
                dendriteCollateralName: f.dendrite_collateral_name,
                ...(f.input != null ? { input: f.input } : {}),
            }));
        const ctx: Record<string, unknown> = {};
        for (const c of context) ctx[c.neuron_name] = c.value;
        return { tasks, context: ctx };
    }
}

// ── row shapes (jsonb columns come back already parsed by node-pg) ──
type TStimulationRow = {
    stimulation_id: string;
    entry: TCNSSignalJSON;
    status: ECNSStimulationStatus;
    scope_name: string | null;
};
type TFrontierRow = {
    stimulation_id: string;
    ord: number;
    neuron_name: string;
    dendrite_collateral_name: string;
    input: TCNSSignalJSON | null;
};
type TContextRow = {
    stimulation_id: string;
    neuron_name: string;
    value: unknown;
};
type TAttemptRow = {
    stimulation_attempt_id: string;
    stimulation_id: string;
    attempt_number: number;
    status: ECNSStimulationStatus;
    started_at: string | number;
    completed_at: string | number | null;
    hop_count: number;
    has_error: boolean;
    replay_of: string | null;
    entry: TCNSSignalJSON[];
};
type TTaskRow = {
    stimulation_attempt_id: string;
    index: number;
    neuron_name: string;
    dendrite_collateral_name: string;
    input_index: number;
    output: TCNSSignalJSON | null;
    status: ECNSStimulationTaskStatus;
    error: string | null;
    started_at: string | number;
    duration: number | null;
};
/** One roster CTE row (see `selectRoster`), with the window total attached. */
type TRosterRow = {
    stimulation_id: string;
    entry: unknown;
    status: string;
    scope_name: string | null;
    started_at: string | number;
    completed_at: string | number | null;
    hop_count: string | number;
    has_error: boolean;
    neurons: string[] | null;
    total_count: string | number;
};

function rowToAttempt(a: TAttemptRow): TCNSStimulationAttempt {
    return {
        stimulationAttemptId: a.stimulation_attempt_id,
        stimulationId: a.stimulation_id,
        attemptNumber: num(a.attempt_number),
        status: a.status,
        startedAt: num(a.started_at),
        completedAt: numOrNull(a.completed_at),
        hopCount: num(a.hop_count),
        hasError: Boolean(a.has_error),
        replayOf: a.replay_of ?? null,
        entry: a.entry,
    };
}

function rowToTask(t: TTaskRow): TCNSStimulationTask {
    return {
        stimulationAttemptId: t.stimulation_attempt_id,
        index: num(t.index),
        neuronName: t.neuron_name,
        dendriteCollateralName: t.dendrite_collateral_name,
        inputIndex: num(t.input_index),
        output: t.output ?? null,
        status: t.status,
        error: t.error ?? null,
        startedAt: num(t.started_at),
        duration: numOrNull(t.duration),
    };
}

function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
    const m = new Map<K, T[]>();
    for (const r of rows) {
        const k = key(r);
        const b = m.get(k);
        if (b) b.push(r);
        else m.set(k, [r]);
    }
    return m;
}
