import type { ICNSJobLogRepository } from '../interfaces/ICNSJobLogRepository';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import type { ICNSJobStateRepository } from '../interfaces/ICNSJobStateRepository';
import { CNSJobAttempts } from '../job/CNSJobAttempts';
import { CNSJobCompositeKey } from '../job/CNSJobCompositeKey';
import { CNSJobJsonValue } from '../job/CNSJobJsonValue';
import { CNSJobRateLimiter } from '../rate/CNSJobRateLimiter';
import { CNSJobUnstorableOutcomeError } from '../runtime/CNSJobUnstorableOutcomeError';
import { CNSInMemoryJobLogRepository } from './CNSInMemoryJobLogRepository';
import type { ECNSJobCancelAs } from '../types/ECNSJobCancelAs';
import type { ECNSJobFinalStatus } from '../types/ECNSJobFinalStatus';
import type { TCNSInMemoryJobRepositoryOptions } from '../types/TCNSInMemoryJobRepositoryOptions';
import type { TCNSJobAttempt } from '../types/TCNSJobAttempt';
import type { TCNSJobAttemptOutcome } from '../types/TCNSJobAttemptOutcome';
import type { TCNSJobCancelResult } from '../types/TCNSJobCancelResult';
import type { TCNSJobClaimRequest } from '../types/TCNSJobClaimRequest';
import type { TCNSJobEnqueueOptions } from '../types/TCNSJobEnqueueOptions';
import type { TCNSJobEnqueueRequest } from '../types/TCNSJobEnqueueRequest';
import type { TCNSJobEnqueueResult } from '../types/TCNSJobEnqueueResult';
import type { TCNSJobHistoryState } from '../types/TCNSJobHistoryState';
import type { TCNSJobLease } from '../types/TCNSJobLease';
import type { TCNSJobListQuery } from '../types/TCNSJobListQuery';
import type { TCNSJobPromoteResult } from '../types/TCNSJobPromoteResult';
import type { TCNSJobRenewResult } from '../types/TCNSJobRenewResult';
import type { TCNSJobRepositoryCapabilities } from '../types/TCNSJobRepositoryCapabilities';
import type { TCNSJobRepositoryListener } from '../types/TCNSJobRepositoryListener';
import type { TCNSJobRetentionPolicy } from '../types/TCNSJobRetentionPolicy';
import type { TCNSJobSchedule } from '../types/TCNSJobSchedule';
import type { TCNSJobState } from '../types/TCNSJobState';
import type { TCNSJobThrottle } from '../types/TCNSJobThrottle';
import type { TCNSJobTransition } from '../types/TCNSJobTransition';
import type { TCNSJobTransitionResult } from '../types/TCNSJobTransitionResult';
import type { TCNSJobTypeRegistration } from '../types/TCNSJobTypeRegistration';
import type { TCNSJobTypeSchedule } from '../types/TCNSJobTypeSchedule';
import type { TCNSJobTypeStatus } from '../types/TCNSJobTypeStatus';


export class CNSInMemoryJobRepository implements ICNSJobRepository<never> {
    readonly capabilities: TCNSJobRepositoryCapabilities;
    readonly stateRepository: ICNSJobStateRepository;
    readonly logRepository: ICNSJobLogRepository;

    private readonly now: () => number;
    private readonly generateJobId: () => string;
    private readonly onError: (error: unknown) => void;
    private readonly live = new Map<string, TCNSJobState>();
    private readonly history = new Map<string, TCNSJobHistoryState>();
    private readonly typeThrottles = new Map<string, number>();
    private readonly groupThrottles = new Map<string, number>();
    private readonly schedules = new Map<string, TCNSJobTypeSchedule>();
    private readonly types = new Map<string, TCNSJobTypeStatus>();
    private readonly listeners = new Set<TCNSJobRepositoryListener>();
    private droppedLogJobIds: string[] = [];
    private seq = 0;
    private fairnessTick = 0;

    constructor(options: TCNSInMemoryJobRepositoryOptions = {}) {
        this.now = options.now ?? Date.now;
        this.generateJobId = options.generateJobId ?? (() => globalThis.crypto.randomUUID());
        this.onError = options.onError ?? (() => undefined);
        this.logRepository = options.logRepository ?? new CNSInMemoryJobLogRepository();
        this.capabilities = { transactionalEnqueue: false, pushWakeups: true, history: options.history ?? true };
        this.stateRepository = {
            load: async jobId => structuredClone((this.live.get(jobId) ?? this.history.get(jobId))?.state),
            begin: async () => undefined,
            save: async (jobId, seq, attemptNumber, state) => {
                const jobState = this.openAttempt(jobId, seq, attemptNumber)?.jobState;
                if (!jobState) return false;
                jobState.state = CNSJobJsonValue.copy(state);
                return true;
            },
        };
    }

    async enqueue(requests: readonly TCNSJobEnqueueRequest[], options: TCNSJobEnqueueOptions<never> = {}): Promise<TCNSJobEnqueueResult[]> {
        if (options.transaction !== undefined) {
            throw new Error('[@cnstra/jobs] CNSInMemoryJobRepository does not support transactional enqueue');
        }
        const stored = requests.map(request => ({
            ...request,
            job: { ...request.job, payload: CNSJobJsonValue.copy(request.job.payload), meta: CNSJobJsonValue.copy(request.job.meta), retry: CNSJobJsonValue.copy(request.job.retry) },
        }));
        const results = stored.map(request => this.enqueueOne(request));
        const readyTypes = new Set<string>();
        for (const result of results) {
            const jobState = this.live.get(result.jobId);
            if (result.status !== 'deduplicated' && jobState && this.isReady(jobState)) readyTypes.add(jobState.jobType);
        }
        readyTypes.forEach(jobType => this.emit(listener => listener.ready?.(jobType)));
        return this.afterDroppingLogs(results);
    }

    async claim(requests: readonly TCNSJobClaimRequest[], workerId: string): Promise<TCNSJobTransitionResult> {
        const result: TCNSJobTransitionResult = { transitions: [], claimed: [] };
        for (const request of [...requests].sort((a, b) => a.jobType.localeCompare(b.jobType))) {
            this.claimType(request, workerId, result);
        }
        this.fairnessTick++;
        result.claimed = result.claimed.map(found => structuredClone(found));
        return this.afterDroppingLogs(result);
    }

    async renew(leases: readonly TCNSJobLease[]): Promise<TCNSJobRenewResult> {
        const now = this.now();
        const result: TCNSJobRenewResult = { lostLeases: [], cancelRequests: [] };
        for (const lease of leases) {
            const { jobState, attempt } = this.openAttempt(lease.jobId, lease.seq, lease.attemptNumber) ?? {};
            if (!jobState || !attempt || jobState.lockedUntil === undefined) {
                result.lostLeases.push({ ...lease });
                continue;
            }
            jobState.lockedUntil = now + lease.leaseMs;
            if (attempt.cancelRequest) result.cancelRequests.push({ lease: { ...lease }, cancelRequest: structuredClone(attempt.cancelRequest) });
        }
        return result;
    }

    async finish(
        outcomes: readonly TCNSJobAttemptOutcome[],
        next?: { requests: readonly TCNSJobClaimRequest[]; workerId: string }
    ): Promise<TCNSJobTransitionResult> {
        const accepted = outcomes.filter(outcome => this.accepts(outcome)).map(outcome => this.storable(outcome));
        const transitions: TCNSJobTransition[] = [];
        for (const outcome of accepted) {
            const transition = this.finishOne(outcome);
            if (transition) transitions.push(transition);
        }
        if (!next) return this.afterDroppingLogs({ transitions, claimed: [] });
        const claimed = await this.claim(next.requests, next.workerId);
        return { transitions: [...transitions, ...claimed.transitions], claimed: claimed.claimed };
    }

    async promote(jobTypes: readonly string[], startDeadlineMs: Readonly<Record<string, number>> = {}): Promise<TCNSJobPromoteResult> {
        const now = this.now();
        const types = new Set(jobTypes);
        const result: TCNSJobPromoteResult = { readyJobIds: [], transitions: [] };
        const keys = new Map<string, TCNSJobState>();
        const ordered = [...this.live.values()].sort((a, b) => a.seq - b.seq);
        const waiting = ordered.filter(jobState => jobState.wait !== undefined);

        for (const jobState of ordered) {
            if (!types.has(jobState.jobType) || jobState.lockedUntil !== undefined || !this.live.has(jobState.jobId)) continue;
            const deadline = startDeadlineMs[jobState.jobType];
            const started = CNSJobAttempts.budget(jobState.attempts).started > 0;
            if (deadline !== undefined && !started && Math.max(jobState.createdAt, jobState.runAfter) + deadline < now) {
                result.transitions.push(this.leave(jobState, 'expired'));
                continue;
            }
            if (jobState.wait !== 'scheduled' || jobState.runAfter > now) continue;
            if (jobState.jobKey === undefined || started) {
                jobState.wait = undefined;
            } else {
                jobState.wait = 'key';
                keys.set(jobState.jobKey, jobState);
            }
        }

        for (const keyHolder of keys.values()) this.advanceKey(keyHolder);
        result.readyJobIds = waiting.filter(jobState => this.isReady(this.live.get(jobState.jobId))).map(jobState => jobState.jobId);
        this.announceReady(result.readyJobIds);
        return this.afterDroppingLogs(result);
    }

    async takeStale(jobTypes: readonly string[]): Promise<TCNSJobState[]> {
        const now = this.now();
        const types = new Set(jobTypes);
        return [...this.live.values()]
            .filter(jobState => types.has(jobState.jobType) && jobState.lockedUntil !== undefined && jobState.lockedUntil <= now)
            .map(found => structuredClone(found));
    }

    async repairKeys(jobTypes: readonly string[]): Promise<string[]> {
        const types = new Set(jobTypes);
        const keys = new Map<string, TCNSJobState>();
        for (const jobState of this.live.values()) {
            if (types.has(jobState.jobType) && jobState.wait === 'key' && jobState.jobKey !== undefined) {
                keys.set(jobState.jobKey, jobState);
            }
        }
        const repaired: string[] = [];
        for (const keyHolder of keys.values()) {
            const promoted = this.advanceKey(keyHolder);
            if (promoted) repaired.push(promoted.jobId);
        }
        this.announceReady(repaired);
        return repaired;
    }

    async throttle(jobType: string, jobGroup: string | undefined, nextStartAt: number | undefined): Promise<void> {
        this.applyThrottle(jobType, jobGroup === undefined ? undefined : { jobGroup, nextStartAt: nextStartAt ?? 0 }, nextStartAt);
    }

    async cancel(jobIds: readonly string[], as: ECNSJobCancelAs = 'cancelled'): Promise<TCNSJobCancelResult> {
        const result: TCNSJobCancelResult = { cancelled: [], requested: [] };
        for (const jobId of jobIds) {
            const jobState = this.live.get(jobId);
            if (!jobState) continue;
            if (jobState.lockedUntil === undefined) {
                this.leave(jobState, as);
                result.cancelled.push(jobId);
            } else if (this.requestCancel(jobState, as)) {
                result.requested.push(jobId);
            }
        }
        return this.afterDroppingLogs(result);
    }

    async retry(jobIds: readonly string[]): Promise<string[]> {
        const now = this.now();
        const retried: string[] = [];
        for (const jobId of jobIds) {
            const finished = this.history.get(jobId);
            if (!finished || this.live.has(jobId)) continue;
            this.history.delete(jobId);
            const { finishedAt: _finishedAt, finalStatus: _finalStatus, ...kept } = finished;
            const marker = { attemptNumber: CNSJobAttempts.last(kept.attempts)?.attemptNumber ?? 0, startedAt: now, completedAt: now, status: 'retried' as const };
            const jobState: TCNSJobState = {
                ...kept,
                seq: ++this.seq,
                runAfter: now,
                createdAt: now,
                attempts: CNSJobAttempts.trim([...kept.attempts, marker]),
            };
            this.live.set(jobId, jobState);
            jobState.wait = this.waitFor(jobState);
            retried.push(jobId);
        }
        this.announceReady(retried.filter(jobId => this.isReady(this.live.get(jobId))));
        return retried;
    }

    async runNow(jobIds: readonly string[]): Promise<string[]> {
        const now = this.now();
        const moved: string[] = [];
        for (const jobId of new Set(jobIds)) {
            const jobState = this.live.get(jobId);
            if (!jobState || jobState.lockedUntil !== undefined || jobState.wait === 'unchecked') continue;
            jobState.runAfter = Math.min(jobState.runAfter, now);
            if (jobState.wait === 'scheduled') jobState.wait = this.waitFor(jobState);
            moved.push(jobId);
        }
        this.announceReady(moved.filter(jobId => this.isReady(this.live.get(jobId))));
        return moved;
    }

    async prioritize(jobIds: readonly string[], priority: number): Promise<string[]> {
        if (!Number.isInteger(priority)) throw new TypeError(`[@cnstra/jobs] priority must be an integer, got ${priority}`);
        const changed: string[] = [];
        for (const jobId of new Set(jobIds)) {
            const jobState = this.live.get(jobId);
            if (!jobState || jobState.lockedUntil !== undefined) continue;
            jobState.priority = priority;
            changed.push(jobId);
        }
        return changed;
    }

    async remove(jobIds: readonly string[]): Promise<string[]> {
        const removed: string[] = [];
        for (const jobId of jobIds) {
            const jobState = this.live.get(jobId);
            if (jobState?.lockedUntil !== undefined && jobState.lockedUntil > this.now()) continue;
            if (jobState) {
                this.live.delete(jobId);
                this.dropLogs([jobId]);
                removed.push(jobId);
                const promoted = this.advanceKey(jobState);
                if (promoted) this.announceReady([promoted.jobId]);
            } else if (this.history.delete(jobId)) {
                this.dropLogs([jobId]);
                removed.push(jobId);
            }
        }
        return this.afterDroppingLogs(removed);
    }

    async get(jobId: string): Promise<TCNSJobState | TCNSJobHistoryState | undefined> {
        const found = this.live.get(jobId) ?? this.history.get(jobId);
        return found ? structuredClone(found) : undefined;
    }

    async list(query: TCNSJobListQuery = {}): Promise<TCNSJobState[]> {
        const types = query.jobTypes === undefined ? undefined : new Set(query.jobTypes);
        const after = query.after;
        const found = [...this.live.values()]
            .filter(jobState => types === undefined || types.has(jobState.jobType))
            .filter(jobState => query.running === undefined || (jobState.lockedUntil !== undefined) === query.running)
            .filter(jobState => after === undefined || jobState.runAfter > after.runAfter || (jobState.runAfter === after.runAfter && jobState.seq > after.seq))
            .sort((a, b) => a.runAfter - b.runAfter || a.seq - b.seq);
        return structuredClone(query.limit === undefined ? found : found.slice(0, query.limit));
    }

    async maintain(
        retention: Readonly<Record<string, TCNSJobRetentionPolicy>>,
        dedupWindowMs: Readonly<Record<string, number>>,
        horizonMs?: number
    ): Promise<string[]> {
        const now = this.now();
        const removed: string[] = [];
        const drop = (finished: TCNSJobHistoryState) => {
            this.history.delete(finished.jobId);
            removed.push(finished.jobId);
        };
        const outsideWindow = (finished: TCNSJobHistoryState) => finished.finishedAt + (dedupWindowMs[finished.jobType] ?? 0) < now;
        const groups = new Map<string, TCNSJobHistoryState[]>();
        for (const finished of [...this.history.values()]) {
            if (horizonMs !== undefined && finished.finishedAt + horizonMs < now) {
                drop(finished);
                continue;
            }
            const rule = retention[finished.jobType]?.[finished.finalStatus];
            if (!rule) continue;
            if (rule.keepAgeMs !== undefined && finished.finishedAt + rule.keepAgeMs < now && outsideWindow(finished)) {
                drop(finished);
                continue;
            }
            const group = CNSJobCompositeKey.of(finished.jobType, finished.finalStatus);
            groups.set(group, [...(groups.get(group) ?? []), finished]);
        }
        for (const finishedJobs of groups.values()) {
            const keepCount = retention[finishedJobs[0].jobType]?.[finishedJobs[0].finalStatus]?.keepCount;
            if (keepCount === undefined) continue;
            finishedJobs
                .sort((a, b) => b.finishedAt - a.finishedAt)
                .slice(keepCount)
                .filter(outsideWindow)
                .forEach(drop);
        }
        this.dropLogs(removed);
        return this.afterDroppingLogs(removed);
    }

    async upsertSchedules(jobType: string, schedules: readonly TCNSJobSchedule[], fromDefinition: boolean): Promise<void> {
        const stored = schedules.map(schedule => CNSJobJsonValue.copy(schedule));
        for (const schedule of stored) this.schedules.set(schedule.scheduleId, { ...schedule, jobType, fromDefinition });
    }

    async removeSchedules(jobType: string, scheduleIds: readonly string[]): Promise<void> {
        for (const scheduleId of scheduleIds) {
            if (this.schedules.get(scheduleId)?.jobType === jobType) this.schedules.delete(scheduleId);
        }
    }

    async listSchedules(jobTypes: readonly string[]): Promise<TCNSJobTypeSchedule[]> {
        const types = new Set(jobTypes);
        return [...this.schedules.values()].filter(schedule => types.has(schedule.jobType)).map(found => structuredClone(found));
    }

    async registerTypes(registrations: readonly TCNSJobTypeRegistration[]): Promise<() => Promise<void>> {
        const stored = registrations.map(registration => ({ ...registration, meta: CNSJobJsonValue.copy(registration.meta) }));
        for (const registration of stored) {
            const known = this.types.get(registration.jobType);
            this.types.set(registration.jobType, {
                jobType: registration.jobType,
                meta: registration.meta,
                handlers: (known?.handlers ?? 0) + 1,
            });
        }
        let released = false;
        return async () => {
            if (released) return;
            released = true;
            for (const registration of registrations) {
                const known = this.types.get(registration.jobType);
                if (known) known.handlers = Math.max(0, known.handlers - 1);
            }
        };
    }

    async listTypes(): Promise<TCNSJobTypeStatus[]> {
        return [...this.types.values()].map(found => structuredClone(found));
    }

    async subscribe(listener: TCNSJobRepositoryListener): Promise<() => Promise<void>> {
        this.listeners.add(listener);
        return async () => {
            this.listeners.delete(listener);
        };
    }

    private enqueueOne(request: TCNSJobEnqueueRequest): TCNSJobEnqueueResult {
        const now = this.now();
        const job = request.job;
        const supersededJobIds: string[] = [];

        if (job.jobId !== undefined) {
            const holder = this.live.get(job.jobId) ?? this.finishedWithin(this.history.get(job.jobId), request.idempotencyWindowMs, now);
            if (holder) return { jobId: job.jobId, status: 'deduplicated', supersededJobIds };
        }

        if (job.jobKey !== undefined && request.keyMode !== undefined) {
            const sameKey = [...this.live.values()]
                .filter(jobState => jobState.jobType === job.jobType && jobState.jobKey === job.jobKey)
                .sort((a, b) => a.seq - b.seq);

            if (request.keyMode === 'leading') {
                const holder =
                    sameKey[0] ??
                    [...this.history.values()].find(
                        finished =>
                            finished.jobType === job.jobType &&
                            finished.jobKey === job.jobKey &&
                            this.finishedWithin(finished, request.uniqueWindowMs ?? -1, now)
                    );
                if (holder) return { jobId: holder.jobId, status: 'deduplicated', supersededJobIds };
            }

            if (request.keyMode === 'latest' || request.keyMode === 'switch') {
                for (const jobState of sameKey) {
                    if (jobState.lockedUntil === undefined && jobState.attempts.length > 0) {
                        this.leave(jobState, 'superseded');
                        supersededJobIds.push(jobState.jobId);
                    } else if (request.keyMode === 'switch' && jobState.lockedUntil !== undefined) {
                        this.requestCancel(jobState, 'superseded');
                    }
                }
                const pending = sameKey.find(
                    jobState => this.live.has(jobState.jobId) && jobState.lockedUntil === undefined && jobState.attempts.length === 0
                );
                if (pending) {
                    pending.payload = job.payload;
                    if (job.meta !== undefined) pending.meta = job.meta;
                    pending.runAfter = request.debounce
                        ? Math.min(now + request.debounce.quietMs, pending.createdAt + request.debounce.maxWaitMs)
                        : job.runAfter ?? now;
                    pending.wait = this.waitFor(pending);
                    return { jobId: pending.jobId, status: 'replaced', supersededJobIds };
                }
            }
        }

        const jobState: TCNSJobState = {
            jobId: job.jobId ?? this.generateJobId(),
            seq: ++this.seq,
            jobType: job.jobType,
            payload: job.payload,
            meta: job.meta,
            retry: job.retry,
            jobKey: job.jobKey,
            jobGroup: job.jobGroup,
            priority: job.priority ?? 0,
            runAfter: request.debounce ? now + request.debounce.quietMs : job.runAfter ?? now,
            createdAt: job.createdAt ?? now,
            attempts: [],
        };
        if (this.history.delete(jobState.jobId)) this.dropLogs([jobState.jobId]);
        this.live.set(jobState.jobId, jobState);
        jobState.wait = this.waitFor(jobState);
        return { jobId: jobState.jobId, status: 'inserted', supersededJobIds };
    }

    private claimType(request: TCNSJobClaimRequest, workerId: string, result: TCNSJobTransitionResult): void {
        const now = this.now();
        const running = [...this.live.values()].filter(
            jobState => jobState.jobType === request.jobType && jobState.lockedUntil !== undefined
        );
        let free = request.free;
        if (request.maxRunning !== undefined) free = Math.min(free, request.maxRunning - running.length);
        if (free <= 0) return;

        const typeStarts = CNSJobRateLimiter.take(this.typeThrottles.get(request.jobType), now, request.rate, free);
        free = typeStarts.granted;
        if (free <= 0) return;

        const runningKeys = new Set(
            [...this.live.values()].filter(jobState => jobState.lockedUntil !== undefined).map(jobState => jobState.jobKey)
        );
        const candidates = [...this.live.values()]
            .filter(
                jobState =>
                    jobState.jobType === request.jobType &&
                    this.isReady(jobState) &&
                    (jobState.jobKey === undefined || !runningKeys.has(jobState.jobKey))
            )
            .sort((a, b) => b.priority - a.priority || a.runAfter - b.runAfter || a.seq - b.seq);

        const runningPerGroup = new Map<string, number>();
        for (const jobState of running) {
            if (jobState.jobGroup !== undefined) runningPerGroup.set(jobState.jobGroup, (runningPerGroup.get(jobState.jobGroup) ?? 0) + 1);
        }

        let started = 0;
        for (const jobState of request.fairness ? this.interleaveGroups(candidates) : candidates) {
            if (started >= free) break;
            const maxStarted = jobState.retry?.maxStarted ?? request.maxStarted;
            if (maxStarted !== undefined && CNSJobAttempts.budget(jobState.attempts).started >= maxStarted) {
                result.transitions.push(this.leave(jobState, 'failed'));
                continue;
            }
            if (jobState.jobKey !== undefined && runningKeys.has(jobState.jobKey)) continue;
            if (jobState.jobGroup !== undefined) {
                const groupRunning = runningPerGroup.get(jobState.jobGroup) ?? 0;
                if (request.maxRunningPerGroup !== undefined && groupRunning >= request.maxRunningPerGroup) continue;
                const key = CNSJobCompositeKey.of(request.jobType, jobState.jobGroup);
                const groupStarts = CNSJobRateLimiter.take(this.groupThrottles.get(key), now, request.groupRate, 1);
                if (groupStarts.granted === 0) continue;
                this.setThrottle(this.groupThrottles, key, groupStarts.nextStartAt);
                runningPerGroup.set(jobState.jobGroup, groupRunning + 1);
            }
            jobState.lockedUntil = now + request.leaseMs;
            jobState.attempts = CNSJobAttempts.trim([
                ...jobState.attempts,
                { attemptNumber: CNSJobAttempts.nextNumber(jobState.attempts), startedAt: now, meta: { worker: workerId } },
            ]);
            if (jobState.jobKey !== undefined) runningKeys.add(jobState.jobKey);
            result.claimed.push(jobState);
            started++;
        }

        if (request.rate) {
            this.setThrottle(
                this.typeThrottles,
                request.jobType,
                CNSJobRateLimiter.take(this.typeThrottles.get(request.jobType), now, request.rate, started).nextStartAt
            );
        }
    }

    private openAttempt(jobId: string, seq: number, attemptNumber: number): { jobState: TCNSJobState; attempt: TCNSJobAttempt } | undefined {
        const jobState = this.live.get(jobId);
        const attempt = jobState?.seq === seq ? CNSJobAttempts.open(jobState.attempts, attemptNumber) : undefined;
        return jobState && attempt ? { jobState, attempt } : undefined;
    }

    private storable(outcome: TCNSJobAttemptOutcome): TCNSJobAttemptOutcome {
        try {
            const attemptMeta = CNSJobJsonValue.copy(outcome.attemptMeta);
            return outcome.kind === 'completed'
                ? { ...outcome, attemptMeta, result: CNSJobJsonValue.copy(outcome.result) }
                : { ...outcome, attemptMeta };
        } catch (error) {
            throw new CNSJobUnstorableOutcomeError(outcome, error);
        }
    }

    private accepts(outcome: TCNSJobAttemptOutcome): boolean {
        const jobState = this.openAttempt(outcome.jobId, outcome.seq, outcome.attemptNumber)?.jobState;
        if (!jobState) return false;
        const staleEnd = outcome.kind !== 'completed' && outcome.attemptStatus === 'stale';
        return !staleEnd || (jobState.lockedUntil !== undefined && jobState.lockedUntil <= this.now());
    }

    private finishOne(outcome: TCNSJobAttemptOutcome): TCNSJobTransition | undefined {
        const { jobState, attempt } = this.openAttempt(outcome.jobId, outcome.seq, outcome.attemptNumber) ?? {};
        if (!jobState || !attempt || !this.accepts(outcome)) return undefined;

        const now = this.now();
        attempt.completedAt = now;
        attempt.errorName = outcome.errorName;
        if (outcome.attemptMeta) attempt.meta = { ...attempt.meta, ...outcome.attemptMeta };
        if (outcome.throttle) this.applyThrottle(jobState.jobType, outcome.throttle, outcome.throttle.nextStartAt);
        const base = { jobId: jobState.jobId, seq: jobState.seq, jobType: jobState.jobType, attemptNumber: outcome.attemptNumber };

        if (outcome.kind !== 'completed' && attempt.cancelRequest) {
            attempt.status = 'cancelled';
            return { ...base, finalStatus: this.leave(jobState, attempt.cancelRequest.as).finalStatus };
        }

        if (outcome.kind === 'completed') {
            attempt.status = 'completed';
            jobState.state = 'result' in outcome ? outcome.result : undefined;
            return { ...base, finalStatus: this.leave(jobState, 'completed').finalStatus };
        }

        attempt.status = outcome.attemptStatus;
        if (outcome.kind === 'final') return { ...base, finalStatus: this.leave(jobState, outcome.finalStatus).finalStatus };

        jobState.lockedUntil = undefined;
        jobState.runAfter = outcome.runAfter;
        jobState.wait = outcome.runAfter > now ? 'scheduled' : undefined;
        this.announceReady(jobState.wait === undefined ? [jobState.jobId] : []);
        return base;
    }

    private leave(jobState: TCNSJobState, finalStatus: ECNSJobFinalStatus): TCNSJobTransition {
        this.live.delete(jobState.jobId);
        if (this.capabilities.history) {
            const { seq: _seq, runAfter: _runAfter, lockedUntil: _lockedUntil, wait: _wait, ...kept } = jobState;
            this.history.set(jobState.jobId, { ...kept, finishedAt: this.now(), finalStatus });
        } else {
            this.dropLogs([jobState.jobId]);
        }
        this.emit(listener => listener.done?.(jobState.jobId));
        const promoted = this.advanceKey(jobState);
        if (promoted) this.announceReady([promoted.jobId]);
        return {
            jobId: jobState.jobId,
            seq: jobState.seq,
            jobType: jobState.jobType,
            attemptNumber: CNSJobAttempts.last(jobState.attempts)?.attemptNumber,
            finalStatus,
        };
    }

    private advanceKey(keyHolder: TCNSJobState): TCNSJobState | undefined {
        if (keyHolder.jobKey === undefined) return undefined;
        const now = this.now();
        const sameKey = [...this.live.values()]
            .filter(jobState => jobState.jobKey === keyHolder.jobKey)
            .sort((a, b) => a.seq - b.seq);
        if (sameKey.some(jobState => this.occupiesKey(jobState))) return undefined;
        const nextUp = sameKey.find(jobState => jobState.wait === 'key' || (jobState.wait === 'scheduled' && jobState.runAfter <= now));
        if (!nextUp) return undefined;
        nextUp.wait = undefined;
        return nextUp;
    }

    private waitFor(jobState: TCNSJobState): TCNSJobState['wait'] {
        if (jobState.runAfter > this.now()) return 'scheduled';
        if (jobState.jobKey === undefined) return undefined;
        const blocked = [...this.live.values()].some(
            other =>
                other.jobId !== jobState.jobId &&
                other.jobKey === jobState.jobKey &&
                (this.occupiesKey(other) || (other.wait === 'key' && other.seq < jobState.seq))
        );
        return blocked ? 'key' : undefined;
    }

    private occupiesKey(jobState: TCNSJobState): boolean {
        if (jobState.lockedUntil !== undefined || jobState.wait === undefined) return true;
        return jobState.wait === 'scheduled' && CNSJobAttempts.budget(jobState.attempts).started > 0;
    }

    private isReady(jobState: TCNSJobState | undefined): boolean {
        return !!jobState && jobState.wait === undefined && jobState.lockedUntil === undefined && jobState.runAfter <= this.now();
    }

    private requestCancel(jobState: TCNSJobState, as: ECNSJobCancelAs): boolean {
        const attempt = CNSJobAttempts.last(jobState.attempts);
        if (!attempt || attempt.completedAt !== undefined) return false;
        if (!attempt.cancelRequest) attempt.cancelRequest = { at: this.now(), as };
        this.emit(listener => listener.cancel?.(jobState.jobId, jobState.seq, attempt.attemptNumber));
        return true;
    }

    private dropLogs(jobIds: readonly string[]): void {
        this.droppedLogJobIds.push(...jobIds);
    }

    private async afterDroppingLogs<TResult>(result: TResult): Promise<TResult> {
        if (this.droppedLogJobIds.length === 0) return result;
        const jobIds = this.droppedLogJobIds;
        this.droppedLogJobIds = [];
        try {
            await this.logRepository.delete(jobIds);
        } catch (error) {
            this.onError(error);
        }
        return result;
    }

    private finishedWithin(
        finished: TCNSJobHistoryState | undefined,
        windowMs: number | undefined,
        now: number
    ): TCNSJobHistoryState | undefined {
        if (!finished) return undefined;
        return windowMs === undefined || finished.finishedAt + windowMs >= now ? finished : undefined;
    }

    private applyThrottle(jobType: string, throttle: TCNSJobThrottle | undefined, nextStartAt: number | undefined): void {
        const [map, key] =
            throttle?.jobGroup !== undefined
                ? [this.groupThrottles, CNSJobCompositeKey.of(jobType, throttle.jobGroup)]
                : [this.typeThrottles, jobType];
        if (nextStartAt === undefined) map.delete(key);
        else map.set(key, Math.max(map.get(key) ?? -Infinity, nextStartAt));
    }

    private setThrottle(map: Map<string, number>, key: string, nextStartAt: number | undefined): void {
        if (nextStartAt === undefined) map.delete(key);
        else map.set(key, nextStartAt);
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

    private announceReady(jobIds: readonly string[]): void {
        const readyTypes = new Set<string>();
        for (const jobId of jobIds) {
            const jobState = this.live.get(jobId);
            if (jobState) readyTypes.add(jobState.jobType);
        }
        readyTypes.forEach(jobType => this.emit(listener => listener.ready?.(jobType)));
    }

    private emit(call: (listener: TCNSJobRepositoryListener) => void): void {
        for (const listener of this.listeners) {
            try {
                call(listener);
            } catch (error) {
                this.onError(error);
            }
        }
    }
}
