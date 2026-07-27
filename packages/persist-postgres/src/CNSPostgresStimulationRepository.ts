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
import type { ICNSStimulationRepository } from '@cnstra/persist';
import type {
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
    TCNSProgress,
    TCNSSerializedTask,
    TCNSSignalRef,
    TCNSStimulationStatus,
    TCNSStimulationTaskStatus,
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
    implements ICNSStimulationRepository
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

    async saveStimulation(s: TCNSStimulationPersisted): Promise<void> {
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

    async saveAttempt(a: TCNSStimulationAttemptPersisted): Promise<void> {
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

    async appendTask(t: TCNSStimulationTaskPersisted): Promise<void> {
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
    ): Promise<TCNSStimulationPersisted | undefined> {
        await this.ensure();
        const { p } = this;
        const stimRes = await this.db.query(
            `SELECT entry, status, scope_name FROM ${p}stimulation WHERE stimulation_id = $1`,
            [stimulationId]
        );
        const row = stimRes.rows[0] as
            | {
                  entry: TCNSSignalRef;
                  status: TCNSStimulationStatus;
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
    }): Promise<TCNSStimulationPersisted[]> {
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
    ): Promise<TCNSStimulationAttemptPersisted[]> {
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
    ): Promise<TCNSStimulationTaskPersisted[]> {
        await this.ensure();
        const { p } = this;
        const res = await this.db.query(
            `SELECT * FROM ${p}task WHERE stimulation_attempt_id = $1 ORDER BY "index"`,
            [stimulationAttemptId]
        );
        return (res.rows as TTaskRow[]).map(rowToTask);
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

    async close(): Promise<void> {
        if (this.ownsPool && this.pool) await this.pool.end();
    }

    // ── helpers ──

    private buildProgress(
        frontier: TFrontierRow[],
        context: TContextRow[]
    ): TCNSProgress {
        const tasks: TCNSSerializedTask[] = [...frontier]
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
    entry: TCNSSignalRef;
    status: TCNSStimulationStatus;
    scope_name: string | null;
};
type TFrontierRow = {
    stimulation_id: string;
    ord: number;
    neuron_name: string;
    dendrite_collateral_name: string;
    input: { collateralName: string; payload?: unknown } | null;
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
    status: TCNSStimulationStatus;
    started_at: string | number;
    completed_at: string | number | null;
    hop_count: number;
    has_error: boolean;
    replay_of: string | null;
    entry: TCNSSignalRef[];
};
type TTaskRow = {
    stimulation_attempt_id: string;
    index: number;
    neuron_name: string;
    dendrite_collateral_name: string;
    input_index: number;
    output: TCNSSignalRef | null;
    status: TCNSStimulationTaskStatus;
    error: string | null;
    started_at: string | number;
    duration: number | null;
};

function rowToAttempt(a: TAttemptRow): TCNSStimulationAttemptPersisted {
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

function rowToTask(t: TTaskRow): TCNSStimulationTaskPersisted {
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
