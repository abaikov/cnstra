import { Pool } from 'pg';
import type {
    ICNSStimulationRepository,
    ICNSStimulationRosterQuery,
    TCNSRosterEntry,
} from '@cnstra/persist';
import { encodeCNSRosterCursor, CNS_HISTOGRAM_BUCKETS } from '@cnstra/persist';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSProgress,
    TCNSSignalJSON,
    ECNSStimulationStatus,
    ECNSStimulationTaskStatus,
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterRow,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterFacets,
} from '@cnstra/persist-dto';
import type { ICNSPgQueryable } from './interfaces/ICNSPgQueryable';
import { CNSPostgresSchemaPartitionRotation } from '@cnstra/postgres-schema';
import type { ICNSPostgresSchemaConnection } from '@cnstra/postgres-schema';
import { CNSPostgresStimulationSchema } from './schema/CNSPostgresStimulationSchema';
import type { TCNSPostgresStimulationRepositoryOptions } from './types/TCNSPostgresStimulationRepositoryOptions';

const j = (v: unknown): string => JSON.stringify(v ?? null);
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export class CNSPostgresStimulationRepository
    implements ICNSStimulationRepository, ICNSStimulationRosterQuery
{
    private static readonly LOCK_STIMULATION = 7;
    private static readonly RETENTION_BATCH = 200;

    private readonly db: ICNSPgQueryable;
    private readonly pool?: Pool;
    private readonly ownsPool: boolean;
    private readonly p: string;
    private readonly autoMigrate: boolean;
    private readonly now: () => number;
    private readonly taskPartitions = new CNSPostgresSchemaPartitionRotation({ premakeDays: 7 });
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
        this.p = CNSPostgresStimulationSchema.assertTablePrefix(opts.tablePrefix ?? CNSPostgresStimulationSchema.DEFAULT_TABLE_PREFIX);
        this.autoMigrate = opts.autoMigrate ?? true;
        if (this.autoMigrate && !this.pool) {
            throw new Error(
                '[@cnstra/persist-postgres] a `queryable` cannot hold the migration transaction: pass `pool` or `connectionString`, or set `autoMigrate: false` and run CNSPostgresStimulationSchema.migrate(pool) yourself'
            );
        }
        this.now = opts.now ?? Date.now;
    }

    private schemaReady(): Promise<void> {
        if (!this.autoMigrate) return Promise.resolve();
        this.ready ??= CNSPostgresStimulationSchema.migrate(this.pool as Pool, this.p).catch(error => {
            this.ready = undefined;
            throw error;
        });
        return this.ready;
    }

    /** Run `fn` in a transaction when a Pool is available; else best-effort inline. */
    private async tx<T>(fn: (db: ICNSPgQueryable) => Promise<T>): Promise<T> {
        if (!this.pool) return fn(this.db);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const out = await fn(client as unknown as ICNSPgQueryable);
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
        await this.schemaReady();
        const { p } = this;
        const now = this.now();
        await this.tx(async db => {
            await this.lockStimulation(db, s.stimulationId);
            const upserted = await db.query(
                `INSERT INTO ${p}stimulation (stimulation_id, entry, status, scope_name, progress, updated_at)
                 VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6)
                 ON CONFLICT (stimulation_id)
                 DO UPDATE SET entry = EXCLUDED.entry, status = EXCLUDED.status,
                    scope_name = EXCLUDED.scope_name, progress = EXCLUDED.progress, updated_at = EXCLUDED.updated_at
                 RETURNING (xmax = 0) AS inserted`,
                [s.stimulationId, j(s.entry), s.status, s.scopeName ?? null, j(s.progress), now]
            );
            if ((upserted.rows[0] as { inserted?: boolean } | undefined)?.inserted !== false) await this.rollUpAttempts(db, s.stimulationId, now);
        });
    }

    async saveAttempt(a: TCNSStimulationAttempt): Promise<void> {
        await this.schemaReady();
        const { p } = this;
        await this.tx(async db => {
            await this.lockStimulation(db, a.stimulationId);
            await db.query(
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
            await this.rollUpAttempts(db, a.stimulationId, this.now());
        });
    }

    private async lockStimulation(db: ICNSPgQueryable, stimulationId: string): Promise<void> {
        await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
            CNSPostgresStimulationRepository.LOCK_STIMULATION,
            this.p + stimulationId,
        ]);
    }

    private async rollUpAttempts(db: ICNSPgQueryable, stimulationId: string, now: number): Promise<void> {
        const { p } = this;
        await db.query(
            `UPDATE ${p}stimulation s
             SET started_at = COALESCE(a.started_at, 0),
                 hop_count = COALESCE(a.hop_count, 0),
                 last_completed_at = a.last_completed_at,
                 updated_at = GREATEST(s.updated_at, $2)
             FROM (
                 SELECT MIN(started_at) AS started_at,
                        SUM(hop_count) AS hop_count,
                        (ARRAY_AGG(completed_at ORDER BY attempt_number DESC))[1] AS last_completed_at
                 FROM ${p}stimulation_attempt WHERE stimulation_id = $1
             ) a
             WHERE s.stimulation_id = $1`,
            [stimulationId, now]
        );
    }

    async appendTask(t: TCNSStimulationTask): Promise<void> {
        await this.schemaReady();
        const { p } = this;
        await this.db.query(
            `INSERT INTO ${p}stimulation_task
                (stimulation_attempt_id, task_index, neuron_name, dendrite_collateral_name,
                 input_index, output, status, error, started_at, duration_ms, activation_context)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb)
             ON CONFLICT (stimulation_attempt_id, task_index, started_at) DO NOTHING`,
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
                t.activationContext ? j(t.activationContext) : null,
            ]
        );
    }

    // ── read ──

    async getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationState | undefined> {
        await this.schemaReady();
        const { p } = this;
        const res = await this.db.query(
            `SELECT stimulation_id, entry, status, scope_name, progress FROM ${p}stimulation WHERE stimulation_id = $1`,
            [stimulationId]
        );
        const row = res.rows[0] as TStimulationRow | undefined;
        return row ? rowToStimulation(row) : undefined;
    }

    async listStimulations(filter?: {
        scopeName?: string;
        since?: number;
    }): Promise<TCNSStimulationState[]> {
        await this.schemaReady();
        const { p } = this;
        const scope = filter?.scopeName ?? null;
        // `since` prunes on `updated_at`, the column this already orders by. It
        // is a prune and not the filter: a run's `started_at` is the minimum over
        // its attempts, and a write always follows the start, so this keeps a
        // superset and the caller's predicate still decides. There is no prune
        // for `until` — a run that started before it may have been written after.
        const since = filter?.since ?? null;
        const res = await this.db.query(
            `SELECT stimulation_id, entry, status, scope_name, progress FROM ${p}stimulation
             WHERE ($1::text IS NULL OR scope_name = $1)
               AND ($2::bigint IS NULL OR updated_at >= $2)
             ORDER BY updated_at DESC`,
            [scope, since]
        );
        return (res.rows as TStimulationRow[]).map(rowToStimulation);
    }

    async getAttempts(
        stimulationId: string
    ): Promise<TCNSStimulationAttempt[]> {
        await this.schemaReady();
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
        await this.schemaReady();
        const { p } = this;
        const res = await this.db.query(
            `SELECT * FROM ${p}stimulation_task WHERE stimulation_attempt_id = $1 ORDER BY task_index`,
            [stimulationAttemptId]
        );
        return (res.rows as TTaskRow[]).map(rowToTask);
    }

    /**
     * Attempts of many stimulations in ONE query, so a page of runs costs one
     * round trip rather than one per run.
     */
    async getAttemptsFor(
        stimulationIds: readonly string[]
    ): Promise<TCNSStimulationAttempt[]> {
        if (stimulationIds.length === 0) return [];
        await this.schemaReady();
        const { p } = this;
        const res = await this.db.query(
            `SELECT * FROM ${p}stimulation_attempt
             WHERE stimulation_id = ANY($1)
             ORDER BY stimulation_id, attempt_number`,
            [stimulationIds as string[]]
        );
        return (res.rows as TAttemptRow[]).map(rowToAttempt);
    }

    /** Tasks of many attempts in ONE query — see {@link getAttemptsFor}. */
    async getTasksFor(
        stimulationAttemptIds: readonly string[]
    ): Promise<TCNSStimulationTask[]> {
        if (stimulationAttemptIds.length === 0) return [];
        await this.schemaReady();
        const { p } = this;
        const res = await this.db.query(
            `SELECT * FROM ${p}stimulation_task
             WHERE stimulation_attempt_id = ANY($1)
             ORDER BY stimulation_attempt_id, task_index`,
            [stimulationAttemptIds as string[]]
        );
        return (res.rows as TTaskRow[]).map(rowToTask);
    }

    // ── roster query capability (filter + keyset + facets pushed into SQL) ──

    /**
     * The CTE every roster read stands on. The roster fields are kept on the
     * stimulation row by `saveAttempt` / `saveStimulation`, so the window and the
     * order come from `stimulation(started_at DESC, stimulation_id)`; the total
     * still counts the whole filtered set. Shared so the facet tallies are counted
     * over exactly the set the roster pages through.
     * The task table is read only when `withNeurons` asks for the neuron names.
     * It binds `$1..$7` (the filter); the keyset cursor belongs to the roster's tail.
     */
    private rosterCte(withNeurons: boolean): string {
        const { p } = this;
        const neurons = withNeurons
            ? `COALESCE((
                   SELECT ARRAY_AGG(DISTINCT t.neuron_name)
                   FROM ${p}stimulation_task t
                   JOIN ${p}stimulation_attempt a ON a.stimulation_attempt_id = t.stimulation_attempt_id
                   WHERE a.stimulation_id = s.stimulation_id
               ), ARRAY[]::text[])`
            : 'ARRAY[]::text[]';
        return `
            WITH roster AS (
                SELECT s.stimulation_id, s.entry, s.status, s.scope_name, s.started_at,
                       CASE WHEN s.status = 'running' THEN NULL ELSE s.last_completed_at END AS completed_at,
                       s.hop_count,
                       (s.status = 'failed') AS has_error,
                       ${neurons} AS neurons
                FROM ${p}stimulation s
                WHERE ($6::bigint IS NULL OR s.started_at >= $6)
                  AND ($7::bigint IS NULL OR s.started_at <= $7)
                  AND ($1::text IS NULL OR s.scope_name = $1)
                  AND ($2::text IS NULL OR s.status = $2)
                  AND ($3::text IS NULL OR s.entry->>'collateralName' = $3)
                  AND ($5::text IS NULL OR strpos(lower(s.stimulation_id), $5) > 0)
            ),
            filtered AS (
                SELECT *, COUNT(*) OVER() AS total_count FROM roster
                WHERE ($4::text IS NULL OR $4 = ANY(neurons))
            )`;
    }

    private async selectRoster(
        filter: TCNSStimulationRosterFilter,
        opts?: { cursor?: string; limit?: number }
    ): Promise<{ entries: TCNSRosterEntry[]; total: number }> {
        await this.schemaReady();
        const { p } = this;
        // Decode the keyset cursor → the (startedAt, stimulationId) to page past.
        let curStarted: number | null = null;
        let curId: string | null = null;
        if (opts?.cursor) {
            // Split on the FIRST separator only. A stimulation id is a key the
            // caller chose — a BullMQ job id, an order number — and one
            // containing `|` would otherwise lose everything after it, sending
            // the page to a run that does not exist.
            const decoded = Buffer.from(opts.cursor, 'base64').toString('utf8');
            const at = decoded.indexOf('|');
            const started = Number(decoded.slice(0, at));
            if (at >= 0 && Number.isFinite(started)) {
                curStarted = started;
                curId = decoded.slice(at + 1);
            }
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
            opts?.limit != null && Number.isFinite(opts.limit) ? ` LIMIT ${Math.max(0, Math.floor(opts.limit))}` : '';
        // The listing discards the neuron array; only a neuron filter reads it.
        const sql = `${this.rosterCte(filter.neuronName != null)}
            -- The count is taken INSIDE \`filtered\`, before the keyset predicate
            -- narrows the set. Counting after it made \`total\` shrink with every
            -- page, while the in-memory reference reports the whole filtered set —
            -- and the two are contractually identical.
            SELECT * FROM filtered
            WHERE ($8::bigint IS NULL OR (started_at, stimulation_id COLLATE "C") < ($8, $9::text COLLATE "C"))
            ORDER BY started_at DESC, stimulation_id COLLATE "C" DESC${limitClause}`;
        const res = await this.db.query(sql, params);
        const rows = res.rows as TRosterRow[];
        // An empty page carries no row to read the window count from — reporting
        // zero there would tell the panel "no runs" for a filter that has plenty.
        // Re-run the SAME query with the cursor dropped rather than maintaining a
        // second hand-written count that can drift from this one.
        let total = rows.length ? Number(rows[0].total_count) : 0;
        if (!rows.length && curStarted !== null) {
            const countRes = await this.db.query(sql, [
                ...params.slice(0, 7),
                null,
                null,
            ]);
            const countRows = countRes.rows as TRosterRow[];
            total = countRows.length ? Number(countRows[0].total_count) : 0;
        }
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
        // Ask for one row beyond the page. Its presence is what says "there is
        // another page" — `total` cannot answer that any more, now that it counts
        // the whole filtered set and knows nothing about how far this cursor walked.
        const { entries, total } = await this.selectRoster(filter, {
            ...opts,
            limit: opts.limit + 1,
        });
        const hasMore = entries.length > opts.limit;
        const rows: TCNSStimulationRosterRow[] = entries
            .slice(0, opts.limit)
            .map(e => e.row);
        const lastRow = rows[rows.length - 1];
        return {
            rows,
            nextCursor: hasMore && lastRow ? encodeCNSRosterCursor(lastRow) : null,
            total,
        };
    }

    async queryFacets(
        filter: TCNSStimulationRosterFilter,
        opts?: { metricPath?: string }
    ): Promise<TCNSStimulationRosterFacets> {
        await this.schemaReady();
        // Four tallies of a few dozen rows. Aggregated here rather than in Node so
        // what crosses the wire is the answer, not the material for it.
        const params: unknown[] = [
            filter.scopeName ?? null,
            filter.status ?? null,
            filter.entryCollateralName ?? null,
            filter.neuronName ?? null,
            filter.text ? filter.text.toLowerCase() : null,
            filter.since ?? null,
            filter.until ?? null,
            // The metric path as a jsonb path array (`a.b` → {a,b}); null when the
            // chart is not summing anything.
            opts?.metricPath ? opts.metricPath.split('.') : null,
        ];

        const sql = `${this.rosterCte(true)},
            -- The histogram's bucket width is derived from the set's own span, the
            -- same ${CNS_HISTOGRAM_BUCKETS}-bucket rule the reference implementation
            -- uses. Computed here so the whole thing stays one round trip.
            bounds AS (
                SELECT MIN(started_at) AS mn, MAX(started_at) AS mx FROM filtered WHERE started_at > 0
            ),
            step AS (
                SELECT mn,
                       GREATEST(1, CEIL((mx - mn)::numeric / ${CNS_HISTOGRAM_BUCKETS})::bigint) AS size
                FROM bounds
            )
            SELECT 'entry' AS kind, entry->>'collateralName' AS key,
                   COUNT(*)::bigint AS cnt,
                   NULL::bigint AS ts_bucket, NULL::bigint AS completed,
                   NULL::bigint AS failed, NULL::bigint AS running,
                   NULL::numeric AS metric
            FROM filtered GROUP BY 2
            UNION ALL
            SELECT 'status', status, COUNT(*)::bigint,
                   NULL, NULL, NULL, NULL, NULL
            FROM filtered GROUP BY 2
            UNION ALL
            -- One row per (run, neuron): the neuron rail counts runs that touched
            -- a neuron, which is what UNNEST over the per-run DISTINCT array gives.
            SELECT 'neuron', n, COUNT(*)::bigint,
                   NULL, NULL, NULL, NULL, NULL
            FROM filtered, UNNEST(neurons) AS n GROUP BY 2
            UNION ALL
            SELECT 'time', NULL, NULL,
                   (step.mn + ((f.started_at - step.mn) / step.size) * step.size)::bigint,
                   COUNT(*) FILTER (WHERE f.status = 'completed')::bigint,
                   COUNT(*) FILTER (WHERE f.status = 'failed')::bigint,
                   COUNT(*) FILTER (WHERE f.status NOT IN ('completed', 'failed'))::bigint,
                   -- Only actual JSON numbers are summed, matching the reference's
                   -- \`typeof v === 'number'\`: a payload field holding "12" as a
                   -- string is not a metric and must not become one here.
                   SUM(
                       CASE WHEN $8::text[] IS NOT NULL
                             AND jsonb_typeof(f.entry->'payload' #> $8::text[]) = 'number'
                            THEN (f.entry->'payload' #> $8::text[])::text::numeric
                       END
                   )
            FROM filtered f, step
            WHERE f.started_at > 0
            GROUP BY 4`;

        const res = await this.db.query(sql, params);
        const rows = res.rows as TFacetRow[];

        const tally = (kind: string) =>
            rows
                .filter(r => r.kind === kind && r.key != null)
                .map(r => ({ key: r.key as string, count: Number(r.cnt) }))
                // Deterministic on ties: a facet rail that reshuffles between two
                // refreshes of the same data reads as data changing.
                .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));

        return {
            byEntryCollateral: tally('entry').map(x => ({
                name: x.key,
                count: x.count,
            })),
            byStatus: tally('status').map(x => ({
                status: x.key,
                count: x.count,
            })),
            byNeuron: tally('neuron').map(x => ({ name: x.key, count: x.count })),
            byTime: rows
                .filter(r => r.kind === 'time' && r.ts_bucket != null)
                .map(r => ({
                    tsBucket: Number(r.ts_bucket),
                    completed: Number(r.completed),
                    failed: Number(r.failed),
                    running: Number(r.running),
                    // Absent rather than 0 when nothing was summed — the reference
                    // only sets `metric` once it has a number to put there.
                    ...(r.metric == null ? {} : { metric: Number(r.metric) }),
                }))
                .sort((a, b) => a.tsBucket - b.tsBucket),
        };
    }

    // ── lifecycle ──

    async delete(stimulationId: string): Promise<void> {
        await this.schemaReady();
        const { p } = this;
        await this.tx(async db => {
            await this.lockStimulation(db, stimulationId);
            await db.query(
                `DELETE FROM ${p}stimulation_task WHERE stimulation_attempt_id IN
                    (SELECT stimulation_attempt_id FROM ${p}stimulation_attempt WHERE stimulation_id = $1)`,
                [stimulationId]
            );
            await db.query(`DELETE FROM ${p}stimulation_attempt WHERE stimulation_id = $1`, [stimulationId]);
            await db.query(`DELETE FROM ${p}stimulation WHERE stimulation_id = $1`, [stimulationId]);
        });
    }

    /**
     * Retention: prune stimulations not updated for `olderThanMs`, with their
     * attempts and tasks, in batches of one transaction each, then the attempts and
     * tasks older than that whose parent row never arrived or is already gone; last,
     * with a pool, drop the daily task partitions that ended before the window and
     * create the next seven.
     * Returns the number of stimulations removed.
     */
    async deleteStale(olderThanMs: number): Promise<number> {
        await this.schemaReady();
        const { p } = this;
        const now = this.now();
        const cutoff = now - Math.max(0, Math.floor(olderThanMs));
        let removedCount = 0;
        let after = '';
        for (;;) {
            const batch = await this.tx(async db => {
                const stale = await db.query(
                    `SELECT stimulation_id FROM ${p}stimulation
                     WHERE updated_at < $1 AND stimulation_id > $2
                     ORDER BY stimulation_id LIMIT $3`,
                    [cutoff, after, CNSPostgresStimulationRepository.RETENTION_BATCH]
                );
                const candidates = (stale.rows as { stimulation_id: string }[]).map(row => row.stimulation_id);
                if (candidates.length === 0) return { candidates, removed: 0 };
                await db.query(
                    `SELECT pg_advisory_xact_lock($1, hashtext($2 || id)) FROM unnest($3::text[]) AS id ORDER BY id`,
                    [CNSPostgresStimulationRepository.LOCK_STIMULATION, p, candidates]
                );
                const removed = await db.query(
                    `DELETE FROM ${p}stimulation WHERE stimulation_id = ANY($1) AND updated_at < $2 RETURNING stimulation_id`,
                    [candidates, cutoff]
                );
                const ids = (removed.rows as { stimulation_id: string }[]).map(row => row.stimulation_id);
                await db.query(
                    `DELETE FROM ${p}stimulation_task t
                     USING ${p}stimulation_attempt a
                     WHERE a.stimulation_attempt_id = t.stimulation_attempt_id AND a.stimulation_id = ANY($1)`,
                    [ids]
                );
                await db.query(`DELETE FROM ${p}stimulation_attempt WHERE stimulation_id = ANY($1)`, [ids]);
                return { candidates, removed: ids.length };
            });
            removedCount += batch.removed;
            if (batch.candidates.length < CNSPostgresStimulationRepository.RETENTION_BATCH) break;
            after = batch.candidates[batch.candidates.length - 1];
        }
        let rotationFailure: { error: unknown } | undefined;
        if (this.pool) {
            try {
                await this.taskPartitions.rotate({ transaction: work => this.tx(db => work(db as unknown as ICNSPostgresSchemaConnection)) }, `${p}stimulation_task`, now, cutoff);
            } catch (error) {
                rotationFailure = { error };
            }
        }
        await this.db.query(
            `DELETE FROM ${p}stimulation_attempt a
             WHERE a.started_at < $1
               AND NOT EXISTS (SELECT 1 FROM ${p}stimulation s WHERE s.stimulation_id = a.stimulation_id)`,
            [cutoff]
        );
        await this.db.query(
            `DELETE FROM ${p}stimulation_task t
             WHERE t.started_at < $1
               AND NOT EXISTS (SELECT 1 FROM ${p}stimulation_attempt a WHERE a.stimulation_attempt_id = t.stimulation_attempt_id)`,
            [cutoff]
        );
        if (rotationFailure) throw rotationFailure.error;
        return removedCount;
    }

    async close(): Promise<void> {
        if (this.ownsPool && this.pool) await this.pool.end();
    }

}

// ── row shapes (jsonb columns come back already parsed by node-pg) ──
type TStimulationRow = {
    stimulation_id: string;
    entry: TCNSSignalJSON;
    status: ECNSStimulationStatus;
    scope_name: string | null;
    progress: TCNSProgress;
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
    task_index: number;
    neuron_name: string;
    dendrite_collateral_name: string;
    input_index: number;
    output: TCNSSignalJSON | null;
    status: ECNSStimulationTaskStatus;
    error: string | null;
    started_at: string | number;
    duration_ms: string | number | null;
    activation_context: TCNSStimulationTask['activationContext'] | null;
};
/** One row of the facet union: a tally row (`key`+`cnt`) or a histogram bucket. */
type TFacetRow = {
    kind: string;
    key: string | null;
    cnt: string | null;
    ts_bucket: string | null;
    completed: string | null;
    failed: string | null;
    running: string | null;
    metric: string | null;
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
        index: num(t.task_index),
        neuronName: t.neuron_name,
        dendriteCollateralName: t.dendrite_collateral_name,
        inputIndex: num(t.input_index),
        output: t.output ?? null,
        status: t.status,
        error: t.error ?? null,
        startedAt: num(t.started_at),
        duration: numOrNull(t.duration_ms),
        ...(t.activation_context != null ? { activationContext: t.activation_context } : {}),
    };
}

function rowToStimulation(r: TStimulationRow): TCNSStimulationState {
    return {
        stimulationId: r.stimulation_id,
        entry: r.entry,
        status: r.status,
        progress: r.progress,
        ...(r.scope_name != null ? { scopeName: r.scope_name } : {}),
    };
}
