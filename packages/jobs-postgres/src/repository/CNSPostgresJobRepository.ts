import { CNSJobAttempts, CNSJobRateLimiter, CNSJobUnstorableOutcomeError } from '@cnstra/jobs';
import type {
    ECNSJobCancelAs,
    ECNSJobFinalStatus,
    ICNSJobRepository,
    ICNSJobStateRepository,
    TCNSJobAttempt,
    TCNSJobAttemptOutcome,
    TCNSJobCancelResult,
    TCNSJobClaimRequest,
    TCNSJobEnqueueOptions,
    TCNSJobEnqueueRequest,
    TCNSJobEnqueueResult,
    TCNSJobHistoryState,
    TCNSJobLease,
    TCNSJobListQuery,
    TCNSJobPromoteResult,
    TCNSJobRenewResult,
    TCNSJobRepositoryCapabilities,
    TCNSJobRepositoryListener,
    TCNSJobRetentionPolicy,
    TCNSJobSchedule,
    TCNSJobState,
    TCNSJobThrottle,
    TCNSJobTransition,
    TCNSJobTransitionResult,
    TCNSJobTypeRegistration,
    TCNSJobTypeSchedule,
    TCNSJobTypeStatus,
} from '@cnstra/jobs';
import type { ICNSPostgresJobConnection } from '../interfaces/ICNSPostgresJobConnection';
import type { ICNSPostgresJobDatabase } from '../interfaces/ICNSPostgresJobDatabase';
import type { ICNSPostgresJobSession } from '../interfaces/ICNSPostgresJobSession';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import { CNSPostgresSchemaPartitionRotation } from '@cnstra/postgres-schema';
import { CNSPostgresJobSchema } from '../schema/CNSPostgresJobSchema';
import type { TCNSPostgresJobHistoryRow } from '../types/TCNSPostgresJobHistoryRow';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobRepositoryOptions } from '../types/TCNSPostgresJobRepositoryOptions';
import type { TCNSPostgresJobRow } from '../types/TCNSPostgresJobRow';
import { CNSPostgresJobLogRepository } from './CNSPostgresJobLogRepository';
import { CNSPostgresJobRows } from './CNSPostgresJobRows';

export class CNSPostgresJobRepository implements ICNSJobRepository<ICNSPostgresJobTransaction> {
    private static readonly LOCK_ID = 1;
    private static readonly LOCK_KEY = 2;
    private static readonly LOCK_LIVENESS = 4;
    private static readonly LOCK_PROMOTE = 5;
    private static readonly UNIQUE_VIOLATION = '23505';
    private static readonly RESERVED_SEQ = -1;

    readonly capabilities: TCNSJobRepositoryCapabilities;
    readonly stateRepository: ICNSJobStateRepository;
    readonly logRepository: CNSPostgresJobLogRepository;

    private readonly database: ICNSPostgresJobDatabase;
    private readonly tablePrefix: string;
    private readonly now: () => number;
    private readonly generateJobId: () => string;
    private readonly onError: (error: unknown) => void;
    private readonly listeners = new Set<TCNSJobRepositoryListener>();
    private readonly registrations = new Set<ICNSPostgresJobSession>();
    private readonly partitions = new CNSPostgresSchemaPartitionRotation({ premakeDays: 7 });
    private listening?: Promise<() => Promise<void>>;
    private fairnessTick = 0;
    private closed = false;

    constructor(options: TCNSPostgresJobRepositoryOptions) {
        this.database = options.database;
        this.tablePrefix = CNSPostgresJobSchema.assertTablePrefix(options.tablePrefix ?? CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX);
        this.now = options.now ?? Date.now;
        this.generateJobId = options.generateJobId ?? (() => globalThis.crypto.randomUUID());
        this.onError = options.onError ?? (() => undefined);
        this.capabilities = { transactionalEnqueue: true, pushWakeups: true, history: options.history ?? true };
        this.logRepository = new CNSPostgresJobLogRepository(this.database, this.tablePrefix);
        this.stateRepository = {
            load: async jobId => {
                const result = await this.database.query<{ state: [unknown] | null }>(
                    `SELECT CASE WHEN state IS NULL THEN NULL ELSE jsonb_build_array(state) END AS state FROM ${this.table('job')} WHERE job_id = $1
                     UNION ALL
                     SELECT CASE WHEN state IS NULL THEN NULL ELSE jsonb_build_array(state) END FROM ${this.table('job_history')} WHERE job_id = $1`,
                    [jobId]
                );
                return result.rows[0]?.state?.[0];
            },
            begin: async () => undefined,
            save: async (jobId, seq, attemptNumber, state) => {
                const result = await this.database.query(
                    `UPDATE ${this.table('job')} SET state = $4::text::jsonb
                     WHERE job_id = $1 AND seq = $2 AND (attempts->-1->>'attemptNumber')::int = $3 AND NOT (attempts->-1 ? 'completedAt')`,
                    [jobId, seq, attemptNumber, CNSPostgresJobRows.json(state)]
                );
                return result.rowCount === 1;
            },
        };
    }

    async enqueue(requests: readonly TCNSJobEnqueueRequest[], options: TCNSJobEnqueueOptions<ICNSPostgresJobTransaction> = {}): Promise<TCNSJobEnqueueResult[]> {
        requests.forEach(({ job }) => [job.payload, job.meta, job.retry].forEach(value => CNSPostgresJobRows.json(value)));
        const now = this.now();
        if (options.transaction !== undefined) return this.enqueueInTransaction(this.connectionOf(options.transaction), requests, now);
        return this.transaction(async client => {
            const jobIds = requests.flatMap(({ job }) => (job.jobId === undefined ? [] : [job.jobId]));
            await this.lock(client, CNSPostgresJobRepository.LOCK_ID, jobIds);
            const uncheckedKeys = await client.query<{ job_key: string }>(
                `SELECT DISTINCT job_key FROM ${this.table('job')} WHERE job_id = ANY($1::text[]) AND wait = 'unchecked' AND job_key IS NOT NULL`,
                [jobIds]
            );
            const keys = [
                ...new Set([
                    ...requests.flatMap(({ job }) => (job.jobKey === undefined ? [] : [job.jobKey])),
                    ...uncheckedKeys.rows.map(row => row.job_key),
                ]),
            ].sort();
            await this.lock(client, CNSPostgresJobRepository.LOCK_KEY, keys);
            const resolved: string[] = [];
            const transitions: TCNSJobTransition[] = [];
            for (const jobKey of keys) resolved.push(...(await this.resolveUncheckedOfKey(client, jobKey, now, transitions)));
            const byId = await client.query<TCNSPostgresJobRow>(
                `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')}
                 WHERE job_id = ANY($1::text[]) AND wait = 'unchecked' AND (job_key IS NULL OR job_key = ANY($2::text[]))
                 ORDER BY seq`,
                [jobIds, keys]
            );
            for (const row of byId.rows) {
                const jobId = await this.resolveUnchecked(client, CNSPostgresJobRows.toState(row), now, transitions);
                if (jobId !== undefined) resolved.push(jobId);
            }
            const results: TCNSJobEnqueueResult[] = [];
            for (const request of requests) results.push(await this.enqueueOne(client, request, now));
            if (transitions.length > 0 && results[0]) results[0].transitions = transitions;
            const enqueued = results.filter(result => result.status !== 'deduplicated').map(result => result.jobId);
            await this.notifyReady(client, [...resolved, ...enqueued], now);
            return results;
        });
    }

    async claim(requests: readonly TCNSJobClaimRequest[], workerId: string): Promise<TCNSJobTransitionResult> {
        const now = this.now();
        const result = await this.transaction(client => this.claimWith(client, requests, workerId, now));
        this.fairnessTick++;
        return result;
    }

    async renew(leases: readonly TCNSJobLease[]): Promise<TCNSJobRenewResult> {
        if (leases.length === 0) return { lostLeases: [], cancelRequests: [] };
        const now = this.now();
        const renewed = await Promise.all(
            leases.map(lease =>
                this.database.query<{ cancel_request: TCNSJobAttempt['cancelRequest'] | null }>(
                    `UPDATE ${this.table('job')} SET locked_until = $1::float8 + $5::float8
                     WHERE job_id = $2 AND seq = $3 AND locked_until IS NOT NULL
                       AND (attempts->-1->>'attemptNumber')::int = $4 AND NOT (attempts->-1 ? 'completedAt')
                     RETURNING attempts->-1->'cancelRequest' AS cancel_request`,
                    [now, lease.jobId, lease.seq, lease.attemptNumber, lease.leaseMs]
                )
            )
        );
        const result: TCNSJobRenewResult = { lostLeases: [], cancelRequests: [] };
        leases.forEach((lease, index) => {
            const row = renewed[index].rows[0];
            if (!row) result.lostLeases.push({ ...lease });
            else if (row.cancel_request) result.cancelRequests.push({ lease: { ...lease }, cancelRequest: row.cancel_request });
        });
        return result;
    }

    async finish(
        outcomes: readonly TCNSJobAttemptOutcome[],
        next?: { requests: readonly TCNSJobClaimRequest[]; workerId: string }
    ): Promise<TCNSJobTransitionResult> {
        const now = this.now();
        const result = await this.transaction(async client => {
            const jobIds = outcomes.map(outcome => outcome.jobId);
            const rows = await this.lockJobs(client, jobIds);
            const accepted = outcomes.filter(outcome => this.accepts(rows.get(outcome.jobId), outcome, now)).map(outcome => this.storable(outcome));
            const throttles = accepted.flatMap(outcome => {
                const jobType = rows.get(outcome.jobId)?.jobType;
                return outcome.throttle && jobType !== undefined ? [{ jobType, throttle: outcome.throttle }] : [];
            });
            const transitions: TCNSJobTransition[] = [];
            const readyJobIds: string[] = [];
            for (const outcome of accepted) {
                const transition = await this.finishOne(client, rows, outcome, now, readyJobIds);
                if (transition) transitions.push(transition);
            }
            await this.lockTypeRows(client, [
                ...throttles.map(({ jobType }) => jobType),
                ...(next?.requests ?? []).filter(request => this.limited(request)).map(request => request.jobType),
            ]);
            for (const { jobType, throttle } of throttles) await this.applyThrottle(client, jobType, throttle, throttle.nextStartAt);
            await this.notifyReady(client, readyJobIds, now);
            if (!next) return { transitions, claimed: [] };
            const claimed = await this.claimWith(client, next.requests, next.workerId, now);
            return { transitions: [...transitions, ...claimed.transitions], claimed: claimed.claimed };
        });
        if (next) this.fairnessTick++;
        return result;
    }

    async promote(jobTypes: readonly string[], startDeadlineMs: Readonly<Record<string, number>> = {}): Promise<TCNSJobPromoteResult> {
        if (jobTypes.length === 0) return { readyJobIds: [], transitions: [] };
        const now = this.now();
        return this.transaction(async client => {
            await this.lock(client, CNSPostgresJobRepository.LOCK_PROMOTE, jobTypes);
            const deadlineTypes = Object.keys(startDeadlineMs).filter(jobType => jobTypes.includes(jobType));
            const deadlineArm =
                deadlineTypes.length === 0
                    ? ''
                    : `OR EXISTS (
                        SELECT 1 FROM unnest($3::text[], $4::float8[]) AS d(job_type, deadline_ms)
                        WHERE d.job_type = j.job_type AND greatest(j.created_at, j.run_after) + d.deadline_ms < $2
                    )`;
            const select = `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} j
                WHERE j.job_type = ANY($1::text[]) AND j.locked_until IS NULL AND (
                    j.wait = 'unchecked'
                    OR (j.wait = 'scheduled' AND j.run_after <= $2)
                    ${deadlineArm}
                )
                ORDER BY j.seq`;
            const selectParams =
                deadlineTypes.length === 0
                    ? [jobTypes, now]
                    : [jobTypes, now, deadlineTypes, deadlineTypes.map(jobType => startDeadlineMs[jobType])];
            const first = await client.query<TCNSPostgresJobRow>(select, selectParams);
            const lockedKeys = new Set(first.rows.flatMap(row => (row.job_key === null ? [] : [row.job_key])));
            await this.lock(client, CNSPostgresJobRepository.LOCK_ID, first.rows.filter(row => row.wait === 'unchecked').map(row => row.job_id));
            await this.lock(client, CNSPostgresJobRepository.LOCK_KEY, [...lockedKeys]);
            const rows = (await client.query<TCNSPostgresJobRow>(select, selectParams)).rows
                .map(row => CNSPostgresJobRows.toState(row))
                .filter(jobState => jobState.jobKey === undefined || lockedKeys.has(jobState.jobKey));
            const waiting = rows.filter(jobState => jobState.wait !== undefined && jobState.wait !== 'unchecked').map(jobState => jobState.jobId);
            const result: TCNSJobPromoteResult = { readyJobIds: [], transitions: [] };
            const keys = new Set<string>();
            const left = new Set<string>();

            for (const jobState of rows) {
                if (left.has(jobState.jobId)) continue;
                if (jobState.wait === 'unchecked') {
                    const resolved = await this.resolveUnchecked(client, jobState, now, result.transitions);
                    if (resolved !== undefined) waiting.push(resolved);
                    continue;
                }
                const deadline = startDeadlineMs[jobState.jobType];
                const started = CNSJobAttempts.budget(jobState.attempts).started > 0;
                if (deadline !== undefined && !started && Math.max(jobState.createdAt, jobState.runAfter) + deadline < now) {
                    const transition = await this.leave(client, jobState, 'expired', now, true, waiting);
                    if (transition) {
                        result.transitions.push(transition);
                        left.add(jobState.jobId);
                    }
                    continue;
                }
                if (jobState.wait !== 'scheduled' || jobState.runAfter > now) continue;
                if (jobState.jobKey === undefined || started) {
                    await this.setWait(client, jobState.jobId, undefined);
                } else {
                    await this.setWait(client, jobState.jobId, 'key');
                    keys.add(jobState.jobKey);
                }
            }
            for (const key of keys) {
                const promoted = await this.advanceKey(client, key, now);
                if (promoted) waiting.push(promoted.jobId);
            }
            const ready = await client.query<{ job_id: string; job_type: string }>(
                `SELECT job_id, job_type FROM ${this.table('job')}
                 WHERE job_id = ANY($1::text[]) AND wait IS NULL AND locked_until IS NULL AND run_after <= $2 ORDER BY seq`,
                [[...new Set(waiting)], now]
            );
            result.readyJobIds = ready.rows.map(row => row.job_id);
            for (const jobType of new Set(ready.rows.map(row => row.job_type))) await this.notify(client, 'ready', jobType);
            return result;
        });
    }

    async takeStale(jobTypes: readonly string[]): Promise<TCNSJobState[]> {
        const result = await this.database.query<TCNSPostgresJobRow>(
            `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')}
             WHERE job_type = ANY($1::text[]) AND locked_until IS NOT NULL AND locked_until <= $2 ORDER BY seq`,
            [jobTypes, this.now()]
        );
        return result.rows.map(row => CNSPostgresJobRows.toState(row));
    }

    async repairKeys(jobTypes: readonly string[]): Promise<string[]> {
        const now = this.now();
        return this.transaction(async client => {
            const keys = await client.query<{ job_key: string }>(
                `SELECT DISTINCT job_key FROM ${this.table('job')} WHERE job_type = ANY($1::text[]) AND wait = 'key' AND job_key IS NOT NULL`,
                [jobTypes]
            );
            const sorted = keys.rows.map(row => row.job_key).sort();
            await this.lock(client, CNSPostgresJobRepository.LOCK_KEY, sorted);
            const repaired: string[] = [];
            for (const key of sorted) {
                const promoted = await this.advanceKey(client, key, now);
                if (promoted) repaired.push(promoted.jobId);
            }
            await this.notifyReady(client, repaired, now);
            return repaired;
        });
    }

    async throttle(jobType: string, jobGroup: string | undefined, nextStartAt: number | undefined): Promise<void> {
        await this.transaction(async client => {
            await this.lockTypeRows(client, [jobType]);
            await this.applyThrottle(client, jobType, jobGroup === undefined ? undefined : { jobGroup, nextStartAt: nextStartAt ?? 0 }, nextStartAt);
        });
    }

    async cancel(jobIds: readonly string[], as: ECNSJobCancelAs = 'cancelled'): Promise<TCNSJobCancelResult> {
        const now = this.now();
        return this.transaction(async client => {
            const locked = await this.lockJobs(client, jobIds);
            const transitions: TCNSJobTransition[] = [];
            const unchecked = [...locked.values()].filter(jobState => jobState.wait === 'unchecked');
            const resolved: string[] = [];
            for (const jobKey of [...new Set(unchecked.flatMap(jobState => (jobState.jobKey === undefined ? [] : [jobState.jobKey])))].sort()) {
                resolved.push(...(await this.resolveUncheckedOfKey(client, jobKey, now, transitions)));
            }
            for (const jobState of unchecked.filter(jobState => jobState.jobKey === undefined)) {
                const jobId = await this.resolveUnchecked(client, jobState, now, transitions);
                if (jobId !== undefined) resolved.push(jobId);
            }
            const rows = unchecked.length === 0 ? locked : await this.lockJobs(client, jobIds);
            const result: TCNSJobCancelResult = { cancelled: [], requested: [] };
            if (transitions.length > 0) result.transitions = transitions;
            for (const jobId of jobIds) {
                const jobState = rows.get(jobId);
                if (!jobState) continue;
                if (jobState.lockedUntil === undefined) {
                    await this.leave(client, jobState, as, now);
                    rows.delete(jobId);
                    result.cancelled.push(jobId);
                } else if (await this.requestCancel(client, jobState, as, now)) {
                    result.requested.push(jobId);
                }
            }
            await this.notifyReady(client, resolved.filter(jobId => !result.cancelled.includes(jobId)), now);
            return result;
        });
    }

    async retry(jobIds: readonly string[]): Promise<string[]> {
        const now = this.now();
        return this.transaction(async client => {
            await this.lock(client, CNSPostgresJobRepository.LOCK_ID, jobIds);
            const found = await client.query<TCNSPostgresJobHistoryRow>(
                `SELECT ${CNSPostgresJobRows.HISTORY_COLUMNS} FROM ${this.table('job_history')} h
                 WHERE job_id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM ${this.table('job')} j WHERE j.job_id = h.job_id)`,
                [jobIds]
            );
            const finished = new Map(found.rows.map(row => [row.job_id, CNSPostgresJobRows.toHistory(row)]));
            await this.lock(client, CNSPostgresJobRepository.LOCK_KEY, [...finished.values()].flatMap(row => (row.jobKey === undefined ? [] : [row.jobKey])));
            const retried: string[] = [];
            for (const jobId of jobIds) {
                const history = finished.get(jobId);
                if (!history || retried.includes(jobId)) continue;
                const { finishedAt: _finishedAt, finalStatus: _finalStatus, ...kept } = history;
                const marker: TCNSJobAttempt = {
                    attemptNumber: CNSJobAttempts.last(kept.attempts)?.attemptNumber ?? 0,
                    startedAt: now,
                    completedAt: now,
                    status: 'retried',
                };
                const jobState: TCNSJobState = {
                    ...kept,
                    seq: await this.nextSeq(client),
                    runAfter: now,
                    createdAt: now,
                    attempts: CNSJobAttempts.trim([...kept.attempts, marker]),
                };
                jobState.wait = await this.waitFor(client, jobState, now);
                if (!(await this.insertJob(client, jobState))) continue;
                await client.query(`DELETE FROM ${this.table('job_history')} WHERE job_id = $1`, [jobId]);
                retried.push(jobId);
            }
            await this.notifyReady(client, retried, now);
            return retried;
        });
    }

    async runNow(jobIds: readonly string[]): Promise<string[]> {
        const now = this.now();
        return this.transaction(async client => {
            const rows = await this.lockJobs(client, jobIds);
            const moved: string[] = [];
            for (const jobId of new Set(jobIds)) {
                const jobState = rows.get(jobId);
                if (!jobState || jobState.lockedUntil !== undefined || jobState.wait === 'unchecked') continue;
                jobState.runAfter = Math.min(jobState.runAfter, now);
                if (jobState.wait === 'scheduled') jobState.wait = await this.waitFor(client, jobState, now);
                await client.query(`UPDATE ${this.table('job')} SET run_after = $2, wait = $3 WHERE job_id = $1`, [jobId, jobState.runAfter, jobState.wait ?? null]);
                moved.push(jobId);
            }
            await this.notifyReady(client, moved, now);
            return moved;
        });
    }

    async prioritize(jobIds: readonly string[], priority: number): Promise<string[]> {
        if (!Number.isInteger(priority)) throw new TypeError(`[@cnstra/jobs-postgres] priority must be an integer, got ${priority}`);
        return this.transaction(async client => {
            const rows = await this.lockJobs(client, jobIds);
            const changed = [...new Set(jobIds)].filter(jobId => rows.has(jobId) && rows.get(jobId)?.lockedUntil === undefined);
            if (changed.length > 0) {
                await client.query(`UPDATE ${this.table('job')} SET priority = $2 WHERE job_id = ANY($1::text[])`, [changed, priority]);
            }
            return changed;
        });
    }

    async remove(jobIds: readonly string[]): Promise<string[]> {
        const now = this.now();
        return this.transaction(async client => {
            const rows = await this.lockJobs(client, jobIds);
            const removed: string[] = [];
            for (const jobId of jobIds) {
                const jobState = rows.get(jobId);
                if (jobState?.lockedUntil !== undefined && jobState.lockedUntil > now) continue;
                if (jobState) {
                    rows.delete(jobId);
                    await client.query(`DELETE FROM ${this.table('job')} WHERE job_id = $1`, [jobId]);
                    await this.deleteLogs(client, [jobId]);
                    removed.push(jobId);
                    if (jobState.jobKey !== undefined) {
                        const promoted = await this.advanceKey(client, jobState.jobKey, now);
                        if (promoted) await this.notify(client, 'ready', promoted.jobType);
                    }
                    continue;
                }
                const deleted = await client.query(`DELETE FROM ${this.table('job_history')} WHERE job_id = $1`, [jobId]);
                if (deleted.rowCount === 1) {
                    await this.deleteLogs(client, [jobId]);
                    removed.push(jobId);
                }
            }
            return removed;
        });
    }

    async get(jobId: string): Promise<TCNSJobState | TCNSJobHistoryState | undefined> {
        const live = await this.database.query<TCNSPostgresJobRow>(`SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} WHERE job_id = $1`, [jobId]);
        if (live.rows[0]) return CNSPostgresJobRows.toState(live.rows[0]);
        const finished = await this.database.query<TCNSPostgresJobHistoryRow>(
            `SELECT ${CNSPostgresJobRows.HISTORY_COLUMNS} FROM ${this.table('job_history')} WHERE job_id = $1`,
            [jobId]
        );
        return finished.rows[0] ? CNSPostgresJobRows.toHistory(finished.rows[0]) : undefined;
    }

    async list(query: TCNSJobListQuery = {}): Promise<TCNSJobState[]> {
        const conditions: string[] = [];
        const params: TCNSPostgresJobParameter[] = [];
        const param = (value: TCNSPostgresJobParameter) => {
            params.push(value);
            return `$${params.length}`;
        };
        if (query.jobTypes !== undefined) conditions.push(`job_type = ANY(${param([...query.jobTypes])}::text[])`);
        if (query.running !== undefined) conditions.push(query.running ? 'locked_until IS NOT NULL' : 'locked_until IS NULL');
        if (query.after !== undefined) conditions.push(`(run_after, seq) > (${param(query.after.runAfter)}::float8, ${param(query.after.seq)}::bigint)`);
        const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
        const limit = query.limit === undefined ? '' : `LIMIT ${param(query.limit)}`;
        const result = await this.database.query<TCNSPostgresJobRow>(
            `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} ${where} ORDER BY run_after, seq ${limit}`,
            params
        );
        return result.rows.map(row => CNSPostgresJobRows.toState(row));
    }

    async maintain(
        retention: Readonly<Record<string, TCNSJobRetentionPolicy>>,
        dedupWindowMs: Readonly<Record<string, number>>,
        horizonMs?: number
    ): Promise<string[]> {
        const now = this.now();
        const history = this.table('job_history');
        const dropped: string[] = [];
        let rotationFailure: { error: unknown } | undefined;
        if (horizonMs !== undefined) {
            try {
                await this.partitions.rotate(this.database, history, now, now - horizonMs, async (connection, partition) => {
                    await connection.query(`DELETE FROM ${this.table('job_log')} WHERE job_id IN (SELECT job_id FROM ${partition})`);
                    dropped.push(...(await connection.query<{ job_id: string }>(`SELECT job_id FROM ${partition}`)).rows.map(row => row.job_id));
                });
            } catch (error) {
                rotationFailure = { error };
            }
        }
        const removed = await this.transaction(async client => {
            const removed: string[] = [];
            const collect = (rows: Array<{ job_id: string }>) => removed.push(...rows.map(row => row.job_id));
            if (horizonMs !== undefined) {
                collect((await client.query<{ job_id: string }>(`DELETE FROM ${history} WHERE finished_at < $1 RETURNING job_id`, [now - horizonMs])).rows);
            }
            for (const [jobType, policy] of Object.entries(retention)) {
                const windowMs = dedupWindowMs[jobType] ?? 0;
                for (const [finalStatus, rule] of Object.entries(policy)) {
                    if (!rule) continue;
                    if (rule.keepAgeMs !== undefined) {
                        const aged = await client.query<{ job_id: string }>(
                            `DELETE FROM ${history} WHERE job_type = $1 AND final_status = $2 AND finished_at < $3 RETURNING job_id`,
                            [jobType, finalStatus, now - Math.max(rule.keepAgeMs, windowMs)]
                        );
                        collect(aged.rows);
                    }
                    if (rule.keepCount !== undefined) {
                        const counted = await client.query<{ job_id: string }>(
                            `DELETE FROM ${history} WHERE job_id IN (
                                SELECT job_id FROM (
                                    SELECT job_id, finished_at, row_number() OVER (ORDER BY finished_at DESC) AS position
                                    FROM ${history} WHERE job_type = $1 AND final_status = $2
                                ) ranked WHERE position > $3 AND finished_at + $4 < $5
                            ) RETURNING job_id`,
                            [jobType, finalStatus, rule.keepCount, windowMs, now]
                        );
                        collect(counted.rows);
                    }
                }
            }
            await this.deleteLogs(client, removed);
            return removed;
        });
        if (rotationFailure) throw rotationFailure.error;
        return [...dropped, ...removed];
    }

    async upsertSchedules(jobType: string, schedules: readonly TCNSJobSchedule[], fromDefinition: boolean): Promise<void> {
        const stored = schedules.map(({ scheduleId: _scheduleId, ...schedule }) => CNSPostgresJobRows.json(schedule));
        if (schedules.length === 0) return;
        await this.database.query(
            `INSERT INTO ${this.table('job_schedule')} (schedule_id, job_type, schedule, from_definition)
             SELECT s.schedule_id, $1, s.schedule, $2 FROM unnest($3::text[], $4::text[]::jsonb[]) AS s(schedule_id, schedule)
             ON CONFLICT (schedule_id) DO UPDATE SET job_type = EXCLUDED.job_type, schedule = EXCLUDED.schedule, from_definition = EXCLUDED.from_definition`,
            [jobType, fromDefinition, schedules.map(schedule => schedule.scheduleId), stored]
        );
    }

    async removeSchedules(jobType: string, scheduleIds: readonly string[]): Promise<void> {
        await this.database.query(`DELETE FROM ${this.table('job_schedule')} WHERE job_type = $1 AND schedule_id = ANY($2::text[])`, [jobType, scheduleIds]);
    }

    async listSchedules(jobTypes: readonly string[]): Promise<TCNSJobTypeSchedule[]> {
        const result = await this.database.query<{ schedule_id: string; job_type: string; schedule: Omit<TCNSJobSchedule, 'scheduleId'>; from_definition: boolean }>(
            `SELECT schedule_id, job_type, schedule, from_definition FROM ${this.table('job_schedule')} WHERE job_type = ANY($1::text[]) ORDER BY schedule_id`,
            [jobTypes]
        );
        return result.rows.map(row => ({ ...row.schedule, scheduleId: row.schedule_id, jobType: row.job_type, fromDefinition: row.from_definition }) as TCNSJobTypeSchedule);
    }

    async registerTypes(registrations: readonly TCNSJobTypeRegistration[]): Promise<() => Promise<void>> {
        const metas = registrations.map(registration => CNSPostgresJobRows.json(registration.meta));
        await this.transaction(async client => {
            for (const [index, registration] of registrations.entries()) {
                await client.query(
                    `INSERT INTO ${this.table('job_type')} (job_type, meta, registered) VALUES ($1, $2::text::jsonb, true)
                     ON CONFLICT (job_type) DO UPDATE SET registered = true, meta = EXCLUDED.meta`,
                    [registration.jobType, metas[index]]
                );
            }
        });
        const jobTypes = registrations.map(registration => registration.jobType);
        const liveness: { session?: ICNSPostgresJobSession; released: boolean } = { released: false };
        await this.holdLiveness(jobTypes, liveness);
        return async () => {
            if (liveness.released) return;
            liveness.released = true;
            const session = liveness.session;
            liveness.session = undefined;
            if (!session || !this.registrations.delete(session)) return;
            try {
                for (const jobType of jobTypes) {
                    await session.query('SELECT pg_advisory_unlock_shared($1, hashtext($2))', [CNSPostgresJobRepository.LOCK_LIVENESS, this.tablePrefix + jobType]);
                }
            } finally {
                await session.release();
            }
        };
    }

    async listTypes(): Promise<TCNSJobTypeStatus[]> {
        const result = await this.database.query<{ job_type: string; meta: Record<string, unknown> | null; handlers: number }>(
            `SELECT t.job_type, t.meta, (
                SELECT count(*)::int FROM pg_locks l
                WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 2
                  AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                  AND l.classid::bigint = $1 AND l.objid::bigint = (hashtext($2 || t.job_type)::bigint & 4294967295)
             ) AS handlers
             FROM ${this.table('job_type')} t WHERE t.registered ORDER BY t.job_type`,
            [CNSPostgresJobRepository.LOCK_LIVENESS, this.tablePrefix]
        );
        return result.rows.map(row => ({ jobType: row.job_type, meta: row.meta ?? {}, handlers: row.handlers }));
    }

    async subscribe(listener: TCNSJobRepositoryListener): Promise<() => Promise<void>> {
        if (this.closed) throw new Error('[@cnstra/jobs-postgres] repository is closed');
        this.listeners.add(listener);
        this.listening ??= this.listen();
        try {
            await this.listening;
        } catch (error) {
            this.listeners.delete(listener);
            this.listening = undefined;
            throw error;
        }
        let unsubscribed = false;
        return async () => {
            if (unsubscribed) return;
            unsubscribed = true;
            this.listeners.delete(listener);
            if (this.listeners.size === 0) await this.unlisten();
        };
    }

    async close(): Promise<void> {
        this.closed = true;
        this.listeners.clear();
        await this.unlisten();
        const sessions = [...this.registrations];
        this.registrations.clear();
        await Promise.all(sessions.map(session => session.release()));
    }

    private async holdLiveness(jobTypes: readonly string[], liveness: { session?: ICNSPostgresJobSession; released: boolean }): Promise<void> {
        if (this.closed) throw new Error('[@cnstra/jobs-postgres] repository is closed');
        const session = await this.database.session();
        try {
            for (const jobType of jobTypes) {
                await session.query('SELECT pg_advisory_lock_shared($1, hashtext($2))', [CNSPostgresJobRepository.LOCK_LIVENESS, this.tablePrefix + jobType]);
            }
        } catch (error) {
            await session.release();
            throw error;
        }
        if (liveness.released || this.closed) {
            await session.release();
            return;
        }
        liveness.session = session;
        this.registrations.add(session);
        session.onLost(error => {
            this.onError(error);
            this.registrations.delete(session);
            liveness.session = undefined;
            void session.release().catch(failure => this.onError(failure));
            const retry = () => {
                if (liveness.released || this.closed) return;
                this.holdLiveness(jobTypes, liveness).catch(failure => {
                    this.onError(failure);
                    setTimeout(retry, 1000).unref();
                });
            };
            setTimeout(retry, 100).unref();
        });
    }

    private listen(): Promise<() => Promise<void>> {
        return this.database.listen(
            ['ready', 'unchecked', 'done', 'cancel'].map(name => this.channel(name)),
            (channel, payload) => this.dispatch(channel, payload),
            error => this.relisten(error)
        );
    }

    private relisten(error: unknown): void {
        this.onError(error);
        this.listening = undefined;
        const retry = () => {
            if (this.closed || this.listeners.size === 0 || this.listening) return;
            this.listening = this.listen();
            this.listening.catch(failure => {
                this.onError(failure);
                this.listening = undefined;
                setTimeout(retry, 1000).unref();
            });
        };
        setTimeout(retry, 100).unref();
    }

    private async unlisten(): Promise<void> {
        const listening = this.listening;
        this.listening = undefined;
        if (!listening) return;
        const stop = await listening.catch(() => undefined);
        await stop?.().catch(error => this.onError(error));
    }

    private dispatch(channel: string, payload: string): void {
        for (const listener of this.listeners) {
            try {
                if (channel === this.channel('ready')) listener.ready?.(payload);
                else if (channel === this.channel('unchecked')) listener.unchecked?.(payload);
                else if (channel === this.channel('done')) listener.done?.(payload);
                else if (channel === this.channel('cancel')) {
                    const [jobId, seq, attemptNumber] = JSON.parse(payload) as [string, number, number];
                    listener.cancel?.(jobId, seq, attemptNumber);
                }
            } catch (error) {
                this.onError(error);
            }
        }
    }

    private connectionOf(transaction: unknown): ICNSPostgresJobConnection {
        const candidate = transaction as Partial<ICNSPostgresJobTransaction> | null;
        if (typeof candidate === 'object' && candidate !== null && candidate.cnsJobTransaction === true && typeof candidate.query === 'function') {
            return candidate as ICNSPostgresJobTransaction;
        }
        throw new TypeError(
            '[@cnstra/jobs-postgres] pass the transaction as a connection, for example CNSPgJobConnection.from(client) or CNSPrismaJobConnection.from(tx)'
        );
    }

    private async enqueueInTransaction(
        connection: ICNSPostgresJobConnection,
        requests: readonly TCNSJobEnqueueRequest[],
        now: number
    ): Promise<TCNSJobEnqueueResult[]> {
        const results: TCNSJobEnqueueResult[] = [];
        const signals = new Set<string>();
        for (const request of requests) {
            const job = request.job;
            const jobId = job.jobId ?? this.generateJobId();
            const checked = job.jobId === undefined && job.jobKey === undefined;
            const runAfter = request.debounce ? now + request.debounce.quietMs : job.runAfter ?? now;
            const wait = checked ? (runAfter > now ? 'scheduled' : null) : 'unchecked';
            const enqueueRequest = checked
                ? null
                : CNSPostgresJobRows.json({
                      keyMode: request.keyMode,
                      uniqueWindowMs: request.uniqueWindowMs,
                      idempotencyWindowMs: request.idempotencyWindowMs,
                      debounce: request.debounce,
                      ownJobId: job.jobId !== undefined,
                  });
            const inserted = await connection.query<{ job_id: string }>(
                `INSERT INTO ${this.table('job')}
                    (job_id, seq, job_type, payload, meta, retry, job_key, job_group, priority, run_after, created_at, attempts, wait, enqueue_request)
                 VALUES ($1::text, nextval('${this.table('job_seq')}'), $2::text, $3::text::jsonb, $4::text::jsonb, $5::text::jsonb, $6::text, $7::text,
                         $8::int, $9::float8, $10::float8, '[]'::jsonb, $11::text, $12::text::jsonb)
                 ON CONFLICT (job_id) DO NOTHING
                 RETURNING job_id`,
                [
                    jobId,
                    job.jobType,
                    CNSPostgresJobRows.json(job.payload),
                    CNSPostgresJobRows.json(job.meta),
                    CNSPostgresJobRows.json(job.retry),
                    job.jobKey ?? null,
                    job.jobGroup ?? null,
                    job.priority ?? 0,
                    runAfter,
                    job.createdAt ?? now,
                    wait,
                    enqueueRequest,
                ]
            );
            const stored = inserted.rows.length > 0;
            results.push({ jobId, status: !stored ? 'deduplicated' : checked ? 'inserted' : 'unchecked', supersededJobIds: [] });
            if (stored && wait !== 'scheduled') signals.add(`${checked ? 'ready' : 'unchecked'}\u001f${job.jobType}`);
        }
        for (const signal of signals) {
            const [name, jobType] = signal.split('\u001f');
            await connection.query(`SELECT count(*)::int AS notified FROM (SELECT pg_notify($1::text, $2::text)) AS sent`, [this.channel(name), jobType]);
        }
        return results;
    }

    private async resolveUncheckedOfKey(client: ICNSPostgresJobConnection, jobKey: string, now: number, transitions: TCNSJobTransition[]): Promise<string[]> {
        const rows = await client.query<TCNSPostgresJobRow>(
            `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} WHERE job_key = $1 AND wait = 'unchecked' ORDER BY seq`,
            [jobKey]
        );
        const resolved: string[] = [];
        for (const row of rows.rows) {
            const jobId = await this.resolveUnchecked(client, CNSPostgresJobRows.toState(row), now, transitions);
            if (jobId !== undefined) resolved.push(jobId);
        }
        return resolved;
    }

    private async resolveUnchecked(
        client: ICNSPostgresJobConnection,
        jobState: TCNSJobState,
        now: number,
        transitions: TCNSJobTransition[]
    ): Promise<string | undefined> {
        const deleted = await client.query<{ enqueue_request: Omit<TCNSJobEnqueueRequest, 'job'> & { ownJobId: boolean } }>(
            `DELETE FROM ${this.table('job')} WHERE job_id = $1 AND wait = 'unchecked' RETURNING enqueue_request`,
            [jobState.jobId]
        );
        const stored = deleted.rows[0]?.enqueue_request;
        if (!stored) return undefined;
        const { ownJobId, ...options } = stored;
        const result = await this.enqueueOne(
            client,
            {
                ...options,
                idempotencyWindowMs: ownJobId ? options.idempotencyWindowMs : undefined,
                job: {
                    jobType: jobState.jobType,
                    jobId: jobState.jobId,
                    payload: jobState.payload,
                    meta: jobState.meta,
                    retry: jobState.retry,
                    jobKey: jobState.jobKey,
                    jobGroup: jobState.jobGroup,
                    priority: jobState.priority,
                    runAfter: jobState.runAfter,
                    createdAt: jobState.createdAt,
                },
            },
            now,
            jobState.seq,
            transitions
        );
        return result.status === 'deduplicated' ? undefined : result.jobId;
    }

    private async enqueueOne(
        client: ICNSPostgresJobConnection,
        request: TCNSJobEnqueueRequest,
        now: number,
        seq?: number,
        transitions?: TCNSJobTransition[]
    ): Promise<TCNSJobEnqueueResult> {
        const job = request.job;
        const supersededJobIds: string[] = [];

        if (job.jobId !== undefined) {
            const finished = await client.query<{ finished_at: number }>(`SELECT finished_at FROM ${this.table('job_history')} WHERE job_id = $1`, [job.jobId]);
            const finishedAt = finished.rows[0]?.finished_at;
            if (finishedAt !== undefined && (request.idempotencyWindowMs === undefined || finishedAt + request.idempotencyWindowMs >= now)) {
                return { jobId: job.jobId, status: 'deduplicated', supersededJobIds };
            }
            const reserved = await client.query(
                `INSERT INTO ${this.table('job')} (job_id, seq, job_type, run_after, created_at, attempts, wait)
                 VALUES ($1, ${CNSPostgresJobRepository.RESERVED_SEQ}, $2, 0, 0, '[]'::jsonb, 'unchecked')
                 ON CONFLICT (job_id) DO NOTHING`,
                [job.jobId, job.jobType]
            );
            if (reserved.rowCount !== 1) return { jobId: job.jobId, status: 'deduplicated', supersededJobIds };
        }
        const result = await this.applyEnqueue(client, request, now, seq, transitions);
        if (job.jobId !== undefined && result.status !== 'inserted') await this.releaseReservation(client, job.jobId);
        return result;
    }

    private async releaseReservation(client: ICNSPostgresJobConnection, jobId: string): Promise<void> {
        await client.query(`DELETE FROM ${this.table('job')} WHERE job_id = $1 AND seq = ${CNSPostgresJobRepository.RESERVED_SEQ}`, [jobId]);
    }

    private async applyEnqueue(
        client: ICNSPostgresJobConnection,
        request: TCNSJobEnqueueRequest,
        now: number,
        seq?: number,
        transitions?: TCNSJobTransition[]
    ): Promise<TCNSJobEnqueueResult> {
        const job = request.job;
        const supersededJobIds: string[] = [];

        if (job.jobKey !== undefined && request.keyMode !== undefined) {
            const sameKey = (await this.keyRows(client, job.jobKey)).filter(jobState => jobState.jobType === job.jobType && jobState.wait !== 'unchecked');

            if (request.keyMode === 'leading') {
                const holderId =
                    sameKey[0]?.jobId ??
                    (request.uniqueWindowMs === undefined
                        ? undefined
                        : (
                              await client.query<{ job_id: string }>(
                                  `SELECT job_id FROM ${this.table('job_history')}
                                   WHERE job_type = $1 AND job_key = $2 AND finished_at >= $3 ORDER BY finished_at DESC LIMIT 1`,
                                  [job.jobType, job.jobKey, now - request.uniqueWindowMs]
                              )
                          ).rows[0]?.job_id);
                if (holderId !== undefined) return { jobId: holderId, status: 'deduplicated', supersededJobIds };
            }

            if (request.keyMode === 'latest' || request.keyMode === 'switch') {
                for (const jobState of sameKey) {
                    if (jobState.lockedUntil === undefined && jobState.attempts.length > 0) {
                        const transition = await this.leave(client, jobState, 'superseded', now);
                        if (transition) transitions?.push(transition);
                        supersededJobIds.push(jobState.jobId);
                    } else if (request.keyMode === 'switch' && jobState.lockedUntil !== undefined) {
                        await this.requestCancel(client, jobState, 'superseded', now);
                    }
                }
                const pending = sameKey.find(
                    jobState => !supersededJobIds.includes(jobState.jobId) && jobState.lockedUntil === undefined && jobState.attempts.length === 0
                );
                if (pending) {
                    pending.payload = job.payload;
                    if (job.meta !== undefined) pending.meta = job.meta;
                    pending.runAfter = request.debounce
                        ? Math.min(now + request.debounce.quietMs, pending.createdAt + request.debounce.maxWaitMs)
                        : job.runAfter ?? now;
                    pending.wait = await this.waitFor(client, pending, now);
                    await client.query(
                        `UPDATE ${this.table('job')} SET payload = $2::text::jsonb, meta = $3::text::jsonb, run_after = $4, wait = $5 WHERE job_id = $1`,
                        [pending.jobId, CNSPostgresJobRows.json(pending.payload), CNSPostgresJobRows.json(pending.meta), pending.runAfter, pending.wait ?? null]
                    );
                    return { jobId: pending.jobId, status: 'replaced', supersededJobIds };
                }
            }
        }

        const jobState: TCNSJobState = {
            jobId: job.jobId ?? this.generateJobId(),
            seq: seq ?? (await this.nextSeq(client)),
            jobType: job.jobType,
            payload: job.payload,
            priority: job.priority ?? 0,
            runAfter: request.debounce ? now + request.debounce.quietMs : job.runAfter ?? now,
            createdAt: job.createdAt ?? now,
            attempts: [],
        };
        if (job.meta !== undefined) jobState.meta = job.meta;
        if (job.retry !== undefined) jobState.retry = job.retry;
        if (job.jobKey !== undefined) jobState.jobKey = job.jobKey;
        if (job.jobGroup !== undefined) jobState.jobGroup = job.jobGroup;
        jobState.wait = await this.waitFor(client, jobState, now);
        if (job.jobId !== undefined) await this.releaseReservation(client, job.jobId);
        if (!(await this.insertJob(client, jobState))) return { jobId: jobState.jobId, status: 'deduplicated', supersededJobIds };
        const takenOver = await client.query(`DELETE FROM ${this.table('job_history')} WHERE job_id = $1`, [jobState.jobId]);
        if (takenOver.rowCount) await this.deleteLogs(client, [jobState.jobId]);
        return { jobId: jobState.jobId, status: 'inserted', supersededJobIds };
    }

    private async claimWith(
        client: ICNSPostgresJobConnection,
        requests: readonly TCNSJobClaimRequest[],
        workerId: string,
        now: number
    ): Promise<TCNSJobTransitionResult> {
        const result: TCNSJobTransitionResult = { transitions: [], claimed: [] };
        for (const request of [...requests].sort((a, b) => a.jobType.localeCompare(b.jobType))) {
            await this.claimType(client, request, workerId, now, result);
        }
        return result;
    }

    private limited(request: TCNSJobClaimRequest): boolean {
        return request.maxRunning !== undefined || request.rate !== undefined || request.maxRunningPerGroup !== undefined || request.groupRate !== undefined;
    }

    private async lockTypeRows(client: ICNSPostgresJobConnection, jobTypes: readonly string[]): Promise<void> {
        const sorted = [...new Set(jobTypes)].sort();
        if (sorted.length === 0) return;
        await client.query(
            `INSERT INTO ${this.table('job_type')} (job_type) SELECT unnest($1::text[]) ORDER BY 1 ON CONFLICT DO NOTHING`,
            [sorted]
        );
        await client.query(`SELECT job_type FROM ${this.table('job_type')} WHERE job_type = ANY($1::text[]) ORDER BY job_type FOR UPDATE`, [sorted]);
    }

    private async claimType(client: ICNSPostgresJobConnection, request: TCNSJobClaimRequest, workerId: string, now: number, result: TCNSJobTransitionResult): Promise<void> {
        const limited = this.limited(request);
        if (limited) await this.lockTypeRows(client, [request.jobType]);
        const typeRow = await client.query<{ next_start_at: number | null }>(`SELECT next_start_at FROM ${this.table('job_type')} WHERE job_type = $1`, [
            request.jobType,
        ]);
        const typeNextStartAt = typeRow.rows[0]?.next_start_at ?? undefined;
        const running =
            request.maxRunning === undefined && request.maxRunningPerGroup === undefined
                ? { rows: [] }
                : await client.query<{ job_group: string | null }>(`SELECT job_group FROM ${this.table('job')} WHERE job_type = $1 AND locked_until IS NOT NULL`, [
                      request.jobType,
                  ]);
        let free = request.free;
        if (request.maxRunning !== undefined) free = Math.min(free, request.maxRunning - running.rows.length);
        if (free <= 0) return;

        const typeStarts = CNSJobRateLimiter.take(typeNextStartAt, now, request.rate, free);
        free = typeStarts.granted;
        if (free <= 0) return;

        const runningPerGroup = new Map<string, number>();
        for (const row of running.rows) {
            if (row.job_group !== null) runningPerGroup.set(row.job_group, (runningPerGroup.get(row.job_group) ?? 0) + 1);
        }
        const groupNextStartAt = new Map<string, number>();
        const throttles = await client.query<{ job_group: string; next_start_at: number }>(
            `SELECT job_group, next_start_at FROM ${this.table('job_group_throttle')} WHERE job_type = $1`,
            [request.jobType]
        );
        for (const row of throttles.rows) groupNextStartAt.set(row.job_group, row.next_start_at);
        const blockedGroups = [
            ...[...runningPerGroup].filter(([, count]) => request.maxRunningPerGroup !== undefined && count >= request.maxRunningPerGroup).map(([group]) => group),
            ...[...groupNextStartAt].filter(([, nextStartAt]) => nextStartAt > now).map(([group]) => group),
        ];

        const ready = `job_type = $1 AND wait IS NULL AND locked_until IS NULL AND run_after <= $2
            AND (job_group IS NULL OR NOT (job_group = ANY($4::text[])))
            AND (job_key IS NULL OR NOT EXISTS (SELECT 1 FROM ${this.table('job')} r WHERE r.job_key = j.job_key AND r.locked_until IS NOT NULL))`;
        const rows = request.fairness
            ? await client.query<TCNSPostgresJobRow>(
                  `SELECT c.* FROM (SELECT DISTINCT job_group FROM ${this.table('job')} j WHERE ${ready}) g
                   CROSS JOIN LATERAL (
                       SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} j
                       WHERE ${ready} AND j.job_group IS NOT DISTINCT FROM g.job_group
                       ORDER BY priority DESC, run_after, seq LIMIT $3 FOR UPDATE SKIP LOCKED
                   ) c`,
                  [request.jobType, now, free, blockedGroups]
              )
            : await client.query<TCNSPostgresJobRow>(
                  `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} j WHERE ${ready}
                   ORDER BY priority DESC, run_after, seq LIMIT $3 FOR UPDATE SKIP LOCKED`,
                  [request.jobType, now, free * 4 + 20, blockedGroups]
              );
        const candidates = rows.rows
            .map(row => CNSPostgresJobRows.toState(row))
            .sort((a, b) => b.priority - a.priority || a.runAfter - b.runAfter || a.seq - b.seq);

        const runningKeys = new Set<string>();
        let started = 0;
        for (const jobState of request.fairness ? this.interleaveGroups(candidates) : candidates) {
            if (started >= free) break;
            const maxStarted = jobState.retry?.maxStarted ?? request.maxStarted;
            if (maxStarted !== undefined && CNSJobAttempts.budget(jobState.attempts).started >= maxStarted) {
                if (jobState.jobKey === undefined || (await this.tryLock(client, CNSPostgresJobRepository.LOCK_KEY, jobState.jobKey))) {
                    const transition = await this.leave(client, jobState, 'failed', now);
                    if (transition) result.transitions.push(transition);
                }
                continue;
            }
            if (jobState.jobKey !== undefined && runningKeys.has(jobState.jobKey)) continue;
            if (jobState.jobGroup !== undefined) {
                const groupRunning = runningPerGroup.get(jobState.jobGroup) ?? 0;
                if (request.maxRunningPerGroup !== undefined && groupRunning >= request.maxRunningPerGroup) continue;
                const groupStarts = CNSJobRateLimiter.take(groupNextStartAt.get(jobState.jobGroup), now, request.groupRate, 1);
                if (groupStarts.granted === 0) continue;
                if (request.groupRate !== undefined) {
                    await this.setGroupThrottle(client, request.jobType, jobState.jobGroup, groupStarts.nextStartAt);
                    if (groupStarts.nextStartAt === undefined) groupNextStartAt.delete(jobState.jobGroup);
                    else groupNextStartAt.set(jobState.jobGroup, groupStarts.nextStartAt);
                }
                runningPerGroup.set(jobState.jobGroup, groupRunning + 1);
            }
            const attempts = CNSJobAttempts.trim([
                ...jobState.attempts,
                { attemptNumber: CNSJobAttempts.nextNumber(jobState.attempts), startedAt: now, meta: { worker: workerId } },
            ]);
            const lockedUntil = now + request.leaseMs;
            if (!(await this.lockJob(client, jobState.jobId, lockedUntil, attempts))) continue;
            jobState.lockedUntil = lockedUntil;
            jobState.attempts = attempts;
            if (jobState.jobKey !== undefined) runningKeys.add(jobState.jobKey);
            result.claimed.push(jobState);
            started++;
        }

        if (request.rate) {
            const nextStartAt = CNSJobRateLimiter.take(typeNextStartAt, now, request.rate, started).nextStartAt;
            await client.query(`UPDATE ${this.table('job_type')} SET next_start_at = $2 WHERE job_type = $1`, [request.jobType, nextStartAt ?? null]);
        }
    }

    private async lockJob(client: ICNSPostgresJobConnection, jobId: string, lockedUntil: number, attempts: TCNSJobAttempt[]): Promise<boolean> {
        await client.query('SAVEPOINT cns_claim');
        try {
            await client.query(`UPDATE ${this.table('job')} SET locked_until = $2, attempts = $3::text::jsonb WHERE job_id = $1`, [
                jobId,
                lockedUntil,
                CNSPostgresJobRows.json(attempts),
            ]);
            await client.query('RELEASE SAVEPOINT cns_claim');
            return true;
        } catch (error) {
            await client.query('ROLLBACK TO SAVEPOINT cns_claim');
            if ((error as { code?: string }).code === CNSPostgresJobRepository.UNIQUE_VIOLATION) return false;
            throw error;
        }
    }

    private storable(outcome: TCNSJobAttemptOutcome): TCNSJobAttemptOutcome {
        try {
            CNSPostgresJobRows.json(outcome);
            const attemptMeta = CNSPostgresJobRows.copy(outcome.attemptMeta);
            return outcome.kind === 'completed'
                ? { ...outcome, attemptMeta, result: CNSPostgresJobRows.copy(outcome.result) }
                : { ...outcome, attemptMeta };
        } catch (error) {
            throw new CNSJobUnstorableOutcomeError(outcome, error);
        }
    }

    private accepts(jobState: TCNSJobState | undefined, outcome: TCNSJobAttemptOutcome, now: number): boolean {
        if (!jobState || !this.openAttempt(jobState, outcome.seq, outcome.attemptNumber)) return false;
        const staleEnd = outcome.kind !== 'completed' && outcome.attemptStatus === 'stale';
        return !staleEnd || (jobState.lockedUntil !== undefined && jobState.lockedUntil <= now);
    }

    private openAttempt(jobState: TCNSJobState, seq: number, attemptNumber: number): TCNSJobAttempt | undefined {
        return jobState.seq === seq ? CNSJobAttempts.open(jobState.attempts, attemptNumber) : undefined;
    }

    private async finishOne(
        client: ICNSPostgresJobConnection,
        rows: Map<string, TCNSJobState>,
        outcome: TCNSJobAttemptOutcome,
        now: number,
        readyJobIds: string[]
    ): Promise<TCNSJobTransition | undefined> {
        const jobState = rows.get(outcome.jobId);
        if (!jobState || !this.accepts(jobState, outcome, now)) return undefined;
        const attempt = this.openAttempt(jobState, outcome.seq, outcome.attemptNumber);
        if (!attempt) return undefined;

        attempt.completedAt = now;
        if (outcome.errorName !== undefined) attempt.errorName = outcome.errorName;
        if (outcome.attemptMeta) attempt.meta = { ...attempt.meta, ...outcome.attemptMeta };
        const base = { jobId: jobState.jobId, seq: jobState.seq, jobType: jobState.jobType, attemptNumber: outcome.attemptNumber };

        const leave = async (finalStatus: ECNSJobFinalStatus) => {
            rows.delete(jobState.jobId);
            return { ...base, finalStatus: (await this.leave(client, jobState, finalStatus, now))?.finalStatus };
        };

        if (outcome.kind !== 'completed' && attempt.cancelRequest) {
            attempt.status = 'cancelled';
            return leave(attempt.cancelRequest.as);
        }
        if (outcome.kind === 'completed') {
            attempt.status = 'completed';
            jobState.state = 'result' in outcome ? outcome.result : undefined;
            return leave('completed');
        }
        attempt.status = outcome.attemptStatus;
        if (outcome.kind === 'final') return leave(outcome.finalStatus);

        jobState.lockedUntil = undefined;
        jobState.runAfter = outcome.runAfter;
        jobState.wait = outcome.runAfter > now ? 'scheduled' : undefined;
        await client.query(
            `UPDATE ${this.table('job')} SET attempts = $2::text::jsonb, locked_until = NULL, run_after = $3, wait = $4 WHERE job_id = $1`,
            [jobState.jobId, CNSPostgresJobRows.json(jobState.attempts), jobState.runAfter, jobState.wait ?? null]
        );
        if (jobState.wait === undefined) readyJobIds.push(jobState.jobId);
        return base;
    }

    private async leave(
        client: ICNSPostgresJobConnection,
        jobState: TCNSJobState,
        finalStatus: ECNSJobFinalStatus,
        now: number,
        onlyIfIdle = false,
        promotedJobIds?: string[]
    ): Promise<TCNSJobTransition | undefined> {
        const deleted = await client.query(
            `DELETE FROM ${this.table('job')} WHERE job_id = $1 AND seq = $2${onlyIfIdle ? ' AND locked_until IS NULL' : ''}`,
            [jobState.jobId, jobState.seq]
        );
        if (deleted.rowCount !== 1) return undefined;
        if (this.capabilities.history) {
            await client.query(`DELETE FROM ${this.table('job_history')} WHERE job_id = $1`, [jobState.jobId]);
            await client.query(
                `INSERT INTO ${this.table('job_history')}
                    (job_id, job_type, payload, meta, retry, job_key, job_group, priority, created_at, attempts, state, finished_at, final_status)
                 VALUES ($1, $2, $3::text::jsonb, $4::text::jsonb, $5::text::jsonb, $6, $7, $8, $9, $10::text::jsonb, $11::text::jsonb, $12, $13)`,
                [
                    jobState.jobId,
                    jobState.jobType,
                    CNSPostgresJobRows.json(jobState.payload),
                    CNSPostgresJobRows.json(jobState.meta),
                    CNSPostgresJobRows.json(jobState.retry),
                    jobState.jobKey ?? null,
                    jobState.jobGroup ?? null,
                    jobState.priority,
                    jobState.createdAt,
                    CNSPostgresJobRows.json(jobState.attempts),
                    CNSPostgresJobRows.json(jobState.state),
                    now,
                    finalStatus,
                ]
            );
        } else {
            await this.deleteLogs(client, [jobState.jobId]);
        }
        await this.notify(client, 'done', jobState.jobId);
        if (jobState.jobKey !== undefined) {
            const promoted = await this.advanceKey(client, jobState.jobKey, now);
            if (promoted) {
                promotedJobIds?.push(promoted.jobId);
                await this.notify(client, 'ready', promoted.jobType);
            }
        }
        return {
            jobId: jobState.jobId,
            seq: jobState.seq,
            jobType: jobState.jobType,
            attemptNumber: CNSJobAttempts.last(jobState.attempts)?.attemptNumber,
            finalStatus,
        };
    }

    private async advanceKey(client: ICNSPostgresJobConnection, jobKey: string, now: number): Promise<TCNSJobState | undefined> {
        const sameKey = await this.keyRows(client, jobKey);
        if (sameKey.some(jobState => this.occupiesKey(jobState))) return undefined;
        const nextUp = sameKey.find(jobState => jobState.wait === 'key' || (jobState.wait === 'scheduled' && jobState.runAfter <= now));
        if (!nextUp) return undefined;
        await this.setWait(client, nextUp.jobId, undefined);
        nextUp.wait = undefined;
        return nextUp;
    }

    private async waitFor(client: ICNSPostgresJobConnection, jobState: TCNSJobState, now: number): Promise<TCNSJobState['wait']> {
        if (jobState.runAfter > now) return 'scheduled';
        if (jobState.jobKey === undefined) return undefined;
        const blocked = (await this.keyRows(client, jobState.jobKey)).some(
            other => other.jobId !== jobState.jobId && (this.occupiesKey(other) || (other.wait === 'key' && other.seq < jobState.seq))
        );
        return blocked ? 'key' : undefined;
    }

    private occupiesKey(jobState: TCNSJobState): boolean {
        if (jobState.lockedUntil !== undefined || jobState.wait === undefined) return true;
        return jobState.wait === 'scheduled' && CNSJobAttempts.budget(jobState.attempts).started > 0;
    }

    private async requestCancel(client: ICNSPostgresJobConnection, jobState: TCNSJobState, as: ECNSJobCancelAs, now: number): Promise<boolean> {
        const attempt = CNSJobAttempts.last(jobState.attempts);
        if (!attempt || attempt.completedAt !== undefined) return false;
        if (!attempt.cancelRequest) {
            attempt.cancelRequest = { at: now, as };
            await client.query(
                `UPDATE ${this.table('job')} SET attempts = jsonb_set(attempts, ARRAY[(jsonb_array_length(attempts) - 1)::text, 'cancelRequest'], $2::text::jsonb)
                 WHERE job_id = $1 AND NOT (attempts->-1 ? 'cancelRequest')`,
                [jobState.jobId, CNSPostgresJobRows.json(attempt.cancelRequest)]
            );
        }
        await this.notify(client, 'cancel', JSON.stringify([jobState.jobId, jobState.seq, attempt.attemptNumber]));
        return true;
    }

    private async applyThrottle(client: ICNSPostgresJobConnection, jobType: string, throttle: TCNSJobThrottle | undefined, nextStartAt: number | undefined): Promise<void> {
        if (throttle?.jobGroup !== undefined) {
            if (nextStartAt === undefined) {
                await client.query(`DELETE FROM ${this.table('job_group_throttle')} WHERE job_type = $1 AND job_group = $2`, [jobType, throttle.jobGroup]);
                return;
            }
            await client.query(
                `INSERT INTO ${this.table('job_group_throttle')} (job_type, job_group, next_start_at) VALUES ($1, $2, $3)
                 ON CONFLICT (job_type, job_group) DO UPDATE SET next_start_at = greatest(${this.table('job_group_throttle')}.next_start_at, EXCLUDED.next_start_at)`,
                [jobType, throttle.jobGroup, nextStartAt]
            );
            return;
        }
        await client.query(
            `INSERT INTO ${this.table('job_type')} (job_type, next_start_at) VALUES ($1, $2)
             ON CONFLICT (job_type) DO UPDATE SET next_start_at = CASE
                 WHEN EXCLUDED.next_start_at IS NULL THEN NULL
                 ELSE greatest(${this.table('job_type')}.next_start_at, EXCLUDED.next_start_at) END`,
            [jobType, nextStartAt ?? null]
        );
    }

    private async setGroupThrottle(client: ICNSPostgresJobConnection, jobType: string, jobGroup: string, nextStartAt: number | undefined): Promise<void> {
        if (nextStartAt === undefined) {
            await client.query(`DELETE FROM ${this.table('job_group_throttle')} WHERE job_type = $1 AND job_group = $2`, [jobType, jobGroup]);
            return;
        }
        await client.query(
            `INSERT INTO ${this.table('job_group_throttle')} (job_type, job_group, next_start_at) VALUES ($1, $2, $3)
             ON CONFLICT (job_type, job_group) DO UPDATE SET next_start_at = EXCLUDED.next_start_at`,
            [jobType, jobGroup, nextStartAt]
        );
    }

    private interleaveGroups(candidates: TCNSJobState[]): TCNSJobState[] {
        const groups = new Map<string, TCNSJobState[]>();
        for (const jobState of candidates) {
            const group = jobState.jobGroup ?? '';
            groups.set(group, [...(groups.get(group) ?? []), jobState]);
        }
        const names = [...groups.keys()].sort();
        const offset = names.length === 0 ? 0 : this.fairnessTick % names.length;
        const queues = [...names.slice(offset), ...names.slice(0, offset)].map(name => [...(groups.get(name) ?? [])]);
        const ordered: TCNSJobState[] = [];
        while (queues.some(queue => queue.length > 0)) {
            for (const queue of queues) {
                const jobState = queue.shift();
                if (jobState) ordered.push(jobState);
            }
        }
        return ordered;
    }

    private async lockJobs(client: ICNSPostgresJobConnection, jobIds: readonly string[]): Promise<Map<string, TCNSJobState>> {
        await this.lock(client, CNSPostgresJobRepository.LOCK_ID, jobIds);
        const keys = await client.query<{ job_key: string }>(
            `SELECT DISTINCT job_key FROM ${this.table('job')} WHERE job_id = ANY($1::text[]) AND job_key IS NOT NULL`,
            [jobIds]
        );
        await this.lock(client, CNSPostgresJobRepository.LOCK_KEY, keys.rows.map(row => row.job_key));
        const rows = await client.query<TCNSPostgresJobRow>(
            `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} WHERE job_id = ANY($1::text[]) FOR UPDATE`,
            [jobIds]
        );
        return new Map(rows.rows.map(row => [row.job_id, CNSPostgresJobRows.toState(row)]));
    }

    private async keyRows(client: ICNSPostgresJobConnection, jobKey: string): Promise<TCNSJobState[]> {
        const result = await client.query<TCNSPostgresJobRow>(
            `SELECT ${CNSPostgresJobRows.JOB_COLUMNS} FROM ${this.table('job')} WHERE job_key = $1 ORDER BY seq FOR UPDATE`,
            [jobKey]
        );
        return result.rows.map(row => CNSPostgresJobRows.toState(row));
    }

    private async insertJob(client: ICNSPostgresJobConnection, jobState: TCNSJobState): Promise<boolean> {
        const inserted = await client.query(
            `INSERT INTO ${this.table('job')}
                (job_id, seq, job_type, payload, meta, retry, job_key, job_group, priority, run_after, created_at, attempts, wait, state)
             VALUES ($1, $2, $3, $4::text::jsonb, $5::text::jsonb, $6::text::jsonb, $7, $8, $9, $10, $11, $12::text::jsonb, $13, $14::text::jsonb)
             ON CONFLICT (job_id) DO NOTHING`,
            [
                jobState.jobId,
                jobState.seq,
                jobState.jobType,
                CNSPostgresJobRows.json(jobState.payload),
                CNSPostgresJobRows.json(jobState.meta),
                CNSPostgresJobRows.json(jobState.retry),
                jobState.jobKey ?? null,
                jobState.jobGroup ?? null,
                jobState.priority,
                jobState.runAfter,
                jobState.createdAt,
                CNSPostgresJobRows.json(jobState.attempts),
                jobState.wait ?? null,
                CNSPostgresJobRows.json(jobState.state),
            ]
        );
        return inserted.rowCount === 1;
    }

    private async setWait(client: ICNSPostgresJobConnection, jobId: string, wait: TCNSJobState['wait']): Promise<void> {
        await client.query(`UPDATE ${this.table('job')} SET wait = $2 WHERE job_id = $1`, [jobId, wait ?? null]);
    }

    private async nextSeq(client: ICNSPostgresJobConnection): Promise<number> {
        const result = await client.query<{ seq: number }>(`SELECT nextval('${this.table('job_seq')}')::float8 AS seq`);
        return result.rows[0].seq;
    }

    private async deleteLogs(client: ICNSPostgresJobConnection, jobIds: readonly string[]): Promise<void> {
        if (jobIds.length === 0) return;
        await client.query(`DELETE FROM ${this.table('job_log')} WHERE job_id = ANY($1::text[])`, [jobIds]);
    }

    private async notifyReady(client: ICNSPostgresJobConnection, jobIds: readonly string[], now: number): Promise<void> {
        if (jobIds.length === 0) return;
        const ready = await client.query<{ job_type: string }>(
            `SELECT DISTINCT job_type FROM ${this.table('job')}
             WHERE job_id = ANY($1::text[]) AND wait IS NULL AND locked_until IS NULL AND run_after <= $2`,
            [jobIds, now]
        );
        for (const row of ready.rows) await this.notify(client, 'ready', row.job_type);
    }

    private async notify(client: ICNSPostgresJobConnection, channel: string, payload: string): Promise<void> {
        await client.query('SELECT pg_notify($1, $2)', [this.channel(channel), payload]);
    }

    private async lock(client: ICNSPostgresJobConnection, space: number, names: readonly string[]): Promise<void> {
        const sorted = [...new Set(names)].sort();
        if (sorted.length === 0) return;
        await client.query(
            `SELECT count(*)::int AS locked
             FROM (SELECT name FROM unnest($2::text[]) WITH ORDINALITY AS named(name, position) ORDER BY position) AS ordered
             CROSS JOIN LATERAL (SELECT pg_advisory_xact_lock($1::int, hashtext($3::text || ordered.name))) AS taken`,
            [space, sorted, this.tablePrefix]
        );
    }

    private async tryLock(client: ICNSPostgresJobConnection, space: number, name: string): Promise<boolean> {
        const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked', [space, this.tablePrefix + name]);
        return result.rows[0].locked;
    }

    private transaction<TResult>(work: (client: ICNSPostgresJobConnection) => Promise<TResult>): Promise<TResult> {
        return this.database.transaction(work);
    }

    private channel(name: string): string {
        return `${this.tablePrefix}job_${name}`;
    }

    private table(name: string): string {
        return `${this.tablePrefix}${name}`;
    }
}
