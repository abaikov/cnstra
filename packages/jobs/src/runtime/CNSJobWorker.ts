import { CNSJobEventEmitter } from '../events/CNSJobEventEmitter';
import { CNSJobEnqueueEvents } from '../events/CNSJobEnqueueEvents';
import { CNSJobEventNames } from '../events/CNSJobEventNames';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import { CNSJobAttempts } from '../job/CNSJobAttempts';
import { CNSJobCompositeKey } from '../job/CNSJobCompositeKey';
import { CNSJobErrorName } from '../job/CNSJobErrorName';
import { CNSJobJsonValue } from '../job/CNSJobJsonValue';
import { CNSJobEnqueueRequestBuilder } from '../job/CNSJobEnqueueRequestBuilder';
import { CNSJobMiddlewareChain } from '../middleware/CNSJobMiddlewareChain';
import { CNSJobRetryPolicy } from '../retry/CNSJobRetryPolicy';
import { CNSJobScheduleSlots } from '../schedule/CNSJobScheduleSlots';
import type { ECNSJobAbortReason } from '../types/ECNSJobAbortReason';
import type { ECNSJobAttemptStatus } from '../types/ECNSJobAttemptStatus';
import type { ECNSJobEventName } from '../types/ECNSJobEventName';
import type { ECNSJobFinalStatus } from '../types/ECNSJobFinalStatus';
import type { TCNSJobAttempt } from '../types/TCNSJobAttempt';
import type { TCNSJobAttemptOutcome } from '../types/TCNSJobAttemptOutcome';
import type { TCNSJobClaimRequest } from '../types/TCNSJobClaimRequest';
import type { TCNSJobEnqueueRequest } from '../types/TCNSJobEnqueueRequest';
import type { TCNSJobHandler } from '../types/TCNSJobHandler';
import type { TCNSJobLease } from '../types/TCNSJobLease';
import type { TCNSJobPendingOutcome } from '../types/TCNSJobPendingOutcome';
import type { TCNSJobRetentionPolicy } from '../types/TCNSJobRetentionPolicy';
import type { TCNSJobRunContext } from '../types/TCNSJobRunContext';
import type { TCNSJobRunMiddleware } from '../types/TCNSJobRunMiddleware';
import type { TCNSJobRunningAttempt } from '../types/TCNSJobRunningAttempt';
import type { TCNSJobState } from '../types/TCNSJobState';
import type { TCNSJobTransition } from '../types/TCNSJobTransition';
import type { TCNSJobTransitionResult } from '../types/TCNSJobTransitionResult';
import type { TCNSJobTypeDefinition } from '../types/TCNSJobTypeDefinition';
import type { TCNSJobTypeRegistration } from '../types/TCNSJobTypeRegistration';
import type { TCNSJobWorkerOptions } from '../types/TCNSJobWorkerOptions';
import { CNSJobTimeoutError } from './CNSJobTimeoutError';
import { CNSJobUnstorableOutcomeError } from './CNSJobUnstorableOutcomeError';
import { CNSJobWorkerStoppedError } from './CNSJobWorkerStoppedError';

const ATTEMPT_EVENTS: Record<ECNSJobAttemptStatus, ECNSJobEventName | undefined> = {
    completed: 'attempt.completed',
    failed: 'attempt.failed',
    stale: 'attempt.stale',
    aborted: 'attempt.aborted',
    snoozed: 'attempt.snoozed',
    cancelled: 'attempt.cancelled',
    retried: undefined,
};


export class CNSJobWorker {
    readonly workerId: string;
    readonly events: CNSJobEventEmitter;

    private readonly repository: ICNSJobRepository;
    private readonly handlers = new Map<string, TCNSJobHandler>();
    private readonly middlewares: readonly TCNSJobRunMiddleware[];
    private readonly leaseMs: number;
    private readonly pollIntervalMs: number;
    private readonly promoteIntervalMs: number;
    private readonly maintenanceIntervalMs: number;
    private readonly finishBatchMs: number;
    private readonly stopTimeoutMs: number;
    private readonly scheduleCatchUpMs: number;
    private readonly historyHorizonMs?: number;
    private readonly now: () => number;
    private readonly random: () => number;
    private readonly onError: (error: unknown) => void;

    private status: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
    private stopping?: Promise<void>;
    private readonly running = new Map<string, TCNSJobRunningAttempt>();
    private readonly reserved = new Map<string, number>();
    private readonly scheduleCursors = new Map<string, number>();
    private outcomes: TCNSJobPendingOutcome[] = [];
    private readonly logging = new Set<TCNSJobRunningAttempt>();
    private loopTimers: Array<ReturnType<typeof setInterval>> = [];
    private renewTimer?: ReturnType<typeof setInterval>;
    private flushTimer?: ReturnType<typeof setTimeout>;
    private wakeTimer?: ReturnType<typeof setTimeout>;
    private flushing?: Promise<void>;
    private flushAgain = false;
    private pumping?: Promise<void>;
    private promoting?: Promise<void>;
    private maintaining?: Promise<void>;
    private pumpAgain = false;
    private promoteAgain = false;
    private idleWaiters: Array<() => void> = [];
    private unsubscribe?: () => Promise<void>;
    private release?: () => Promise<void>;

    constructor(options: TCNSJobWorkerOptions) {
        this.repository = options.repository;
        this.middlewares = options.middlewares ?? [];
        this.workerId = options.workerId ?? globalThis.crypto.randomUUID();
        this.leaseMs = options.leaseMs ?? 30_000;
        this.pollIntervalMs = options.pollIntervalMs ?? (this.repository.capabilities.pushWakeups ? 5_000 : 1_000);
        this.promoteIntervalMs = options.promoteIntervalMs ?? 1_000;
        this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? 30_000;
        this.finishBatchMs = options.finishBatchMs ?? 20;
        this.stopTimeoutMs = options.stopTimeoutMs ?? 30_000;
        this.scheduleCatchUpMs = options.scheduleCatchUpMs ?? 0;
        this.historyHorizonMs = options.historyHorizonMs;
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
        // eslint-disable-next-line no-console
        this.onError = options.onError ?? (error => console.error('[@cnstra/jobs]', error));
        this.events = options.events ?? new CNSJobEventEmitter(this.onError);
        for (const handler of options.handlers) {
            if (this.handlers.has(handler.definition.jobType)) {
                throw new Error(`[@cnstra/jobs] two handlers for job type "${handler.definition.jobType}"`);
            }
            this.handlers.set(handler.definition.jobType, handler);
        }
    }

    get runningCount(): number {
        return this.running.size;
    }

    async start(): Promise<void> {
        if (this.status !== 'idle') throw new Error(`[@cnstra/jobs] worker is ${this.status}`);
        this.status = 'starting';
        try {
            this.release = await this.repository.registerTypes([...this.handlers.values()].map(handler => CNSJobWorker.registrationOf(handler.definition)));
            await this.syncSchedules();
            this.unsubscribe = await this.repository.subscribe({
                ready: jobType => {
                    if (this.handlers.has(jobType)) this.wake();
                },
                unchecked: jobType => {
                    if (this.handlers.has(jobType)) this.promoteSoon();
                },
                cancel: (jobId, seq, attemptNumber) => {
                    const run = this.running.get(CNSJobCompositeKey.of(jobId, seq, attemptNumber));
                    if (run) this.abort(run, 'cancel', new Error('job cancelled'));
                },
            });
        } catch (error) {
            await this.teardown();
            this.status = 'idle';
            throw error;
        }
        this.status = 'running';
        this.renewTimer = setInterval(() => void this.renew(), Math.max(1, Math.floor(this.leaseMs / 3)));
        this.loopTimers = [
            setInterval(() => void this.pump(), this.pollIntervalMs),
            setInterval(() => this.promoteSoon(), this.promoteIntervalMs),
            setInterval(() => {
                this.maintaining ??= this.maintain().finally(() => (this.maintaining = undefined));
            }, this.maintenanceIntervalMs),
        ];
        await this.attempt(() => this.enqueueScheduleSlots());
        void this.pump();
    }

    stop(): Promise<void> {
        if (this.status === 'idle') return Promise.resolve();
        if (this.status === 'starting') return Promise.reject(new Error('[@cnstra/jobs] worker is starting'));
        this.stopping ??= this.drain().finally(() => {
            this.stopping = undefined;
            this.status = 'idle';
        });
        return this.stopping;
    }

    private async drain(): Promise<void> {
        this.status = 'stopping';
        this.loopTimers.forEach(clearInterval);
        this.loopTimers = [];
        const background = Promise.all([this.promoting, this.maintaining]);
        await this.pumping;
        if (!(await this.waitIdle(this.stopTimeoutMs))) {
            for (const run of this.running.values()) this.abort(run, 'stop', new CNSJobWorkerStoppedError());
            if (!(await this.waitIdle(this.stopTimeoutMs))) {
                for (const run of this.running.values()) run.submitted = true;
                this.running.clear();
            }
        }
        await background;
        await this.flush();
        this.logging.clear();
        if (this.outcomes.length > 0) {
            this.onError(new Error(`[@cnstra/jobs] ${this.outcomes.length} attempt outcomes were not saved; their leases will expire`));
            this.outcomes = [];
        }
        await this.teardown();
    }

    private async teardown(): Promise<void> {
        if (this.renewTimer) clearInterval(this.renewTimer);
        this.renewTimer = undefined;
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
        if (this.wakeTimer) clearTimeout(this.wakeTimer);
        this.wakeTimer = undefined;
        const unsubscribe = this.unsubscribe;
        this.unsubscribe = undefined;
        const release = this.release;
        this.release = undefined;
        for (const step of [unsubscribe, release]) {
            try {
                await step?.();
            } catch (error) {
                this.onError(error);
            }
        }
    }

    private waitIdle(timeoutMs: number): Promise<boolean> {
        if (this.running.size === 0) return Promise.resolve(true);
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.idleWaiters = this.idleWaiters.filter(waiter => waiter !== done);
                resolve(false);
            }, timeoutMs);
            const done = () => {
                clearTimeout(timer);
                resolve(true);
            };
            this.idleWaiters.push(done);
        });
    }

    private async dedupWindowMs(jobTypes: readonly string[]): Promise<Record<string, number>> {
        const scheduled = new Set((await this.repository.listSchedules(jobTypes)).map(schedule => schedule.jobType));
        const windows: Record<string, number> = {};
        for (const [jobType, handler] of this.handlers) {
            const { idempotencyWindowMs, uniqueWindowMs } = handler.definition;
            const slotWindowMs = scheduled.has(jobType) ? this.scheduleCatchUpMs + this.maintenanceIntervalMs : 0;
            const longest = Math.max(idempotencyWindowMs ?? 0, uniqueWindowMs ?? 0, slotWindowMs);
            if (longest > 0) windows[jobType] = longest;
        }
        return windows;
    }

    private jobTypes(): string[] {
        return [...this.handlers.keys()];
    }

    private static registrationOf(definition: TCNSJobTypeDefinition): TCNSJobTypeRegistration {
        const meta: Record<string, unknown> = {};
        if (definition.payloadSchema !== undefined) meta.payloadSchema = definition.payloadSchema;
        if (definition.description !== undefined) meta.description = definition.description;
        return { jobType: definition.jobType, meta };
    }

    private wake(): void {
        if (this.wakeTimer) return;
        this.wakeTimer = setTimeout(() => {
            this.wakeTimer = undefined;
            void this.pump();
        }, 10 + Math.floor(this.random() * 40));
    }

    private pump(): Promise<void> {
        if (this.status !== 'running') return Promise.resolve();
        if (this.pumping) {
            this.pumpAgain = true;
            return this.pumping;
        }
        this.pumping = this.pumpLoop().finally(() => {
            this.pumping = undefined;
        });
        return this.pumping;
    }

    private async pumpLoop(): Promise<void> {
        do {
            this.pumpAgain = false;
            const requests = this.reserveRequests();
            if (requests.length === 0) return;
            let result: TCNSJobTransitionResult;
            try {
                result = await this.repository.claim(requests, this.workerId);
            } catch (error) {
                this.onError(error);
                return;
            } finally {
                this.unreserve(requests);
            }
            this.accept(result);
            if (result.claimed.length > 0) this.pumpAgain = true;
        } while (this.pumpAgain && this.status === 'running');
    }

    private reserveRequests(): TCNSJobClaimRequest[] {
        const requests: TCNSJobClaimRequest[] = [];
        for (const [jobType, handler] of this.handlers) {
            const definition = handler.definition;
            let busy = this.reserved.get(jobType) ?? 0;
            for (const run of this.running.values()) if (run.jobState.jobType === jobType) busy++;
            const free = (definition.concurrency ?? 1) - busy;
            if (free <= 0) continue;
            this.reserved.set(jobType, (this.reserved.get(jobType) ?? 0) + free);
            requests.push({
                jobType,
                free,
                leaseMs: this.leaseMs,
                maxRunning: definition.maxRunning,
                maxRunningPerGroup: definition.maxRunningPerGroup,
                rate: definition.rate,
                groupRate: definition.groupRate,
                fairness: definition.fairness,
                maxStarted: definition.retry?.maxStarted,
            });
        }
        return requests;
    }

    private unreserve(requests: readonly TCNSJobClaimRequest[]): void {
        for (const request of requests) {
            const left = (this.reserved.get(request.jobType) ?? 0) - request.free;
            if (left > 0) this.reserved.set(request.jobType, left);
            else this.reserved.delete(request.jobType);
        }
    }

    private accept(result: TCNSJobTransitionResult, pending: readonly TCNSJobPendingOutcome[] = []): void {
        this.emitTransitions(result.transitions, pending);
        for (const jobState of result.claimed) {
            if (this.status === 'running') this.startAttempt(jobState);
            else this.releaseUnstarted(jobState);
        }
    }

    private releaseUnstarted(jobState: TCNSJobState): void {
        const attempt = CNSJobAttempts.last(jobState.attempts);
        if (!attempt) return;
        this.submit({
            outcome: {
                jobId: jobState.jobId,
                seq: jobState.seq,
                attemptNumber: attempt.attemptNumber,
                kind: 'requeue',
                attemptStatus: 'aborted',
                runAfter: this.now(),
            },
            jobGroup: jobState.jobGroup,
            startedAt: attempt.startedAt,
            settledAt: this.now(),
            started: false,
        });
    }

    private startAttempt(jobState: TCNSJobState): void {
        const attempt = CNSJobAttempts.last(jobState.attempts);
        if (!attempt) return;
        const run: TCNSJobRunningAttempt = {
            jobState,
            attempt,
            controller: new AbortController(),
            attemptMeta: {},
            logSeq: 0,
            logs: [],
            settled: false,
            submitted: false,
        };
        this.running.set(CNSJobCompositeKey.of(jobState.jobId, jobState.seq, attempt.attemptNumber), run);
        this.events.emit({ name: 'attempt.started', jobId: jobState.jobId, seq: jobState.seq, jobType: jobState.jobType, jobGroup: jobState.jobGroup, attempt });
        void this.execute(run);
    }

    private async execute(run: TCNSJobRunningAttempt): Promise<void> {
        const { jobState, attempt } = run;
        const handler = this.handlers.get(jobState.jobType) as TCNSJobHandler;
        const timeoutMs = handler.definition.timeoutMs;
        const timer =
            timeoutMs === undefined
                ? undefined
                : setTimeout(() => this.timeOut(run, timeoutMs), timeoutMs);

        let returned: { value: unknown } | undefined;
        let thrown: unknown;
        try {
            await this.repository.stateRepository.begin(jobState.jobId, jobState.seq, attempt.attemptNumber);
            const context = this.buildContext(run);
            returned = {
                value: await CNSJobMiddlewareChain.compose<TCNSJobRunContext, unknown>(this.middlewares, async reached =>
                    handler.run(reached.jobState.payload, reached)
                )(context),
            };
        } catch (error) {
            thrown = error;
        } finally {
            run.settled = true;
            if (timer) clearTimeout(timer);
        }

        if (!run.submitted && run.abortReason !== 'leaseLost') {
            this.submit(this.decide(run, returned, thrown));
        }
        this.running.delete(CNSJobCompositeKey.of(jobState.jobId, jobState.seq, attempt.attemptNumber));
        if (this.running.size === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            waiters.forEach(waiter => waiter());
        }
    }

    private timeOut(run: TCNSJobRunningAttempt, timeoutMs: number): void {
        if (run.settled || run.abortReason) return;
        run.timeoutError = new CNSJobTimeoutError(timeoutMs);
        this.abort(run, 'timeout', run.timeoutError);
    }

    private abort(run: TCNSJobRunningAttempt, reason: ECNSJobAbortReason, error: Error): void {
        if (run.settled || run.abortReason) return;
        run.abortReason = reason;
        run.controller.abort(error);
    }

    private decide(run: TCNSJobRunningAttempt, returned: { value: unknown } | undefined, thrown: unknown): TCNSJobPendingOutcome {
        const { jobState, attempt } = run;
        const now = this.now();
        const base = {
            jobId: jobState.jobId,
            seq: jobState.seq,
            attemptNumber: attempt.attemptNumber,
            attemptMeta: Object.keys(run.attemptMeta).length > 0 ? run.attemptMeta : undefined,
        };
        const pending = (outcome: TCNSJobAttemptOutcome, error?: unknown): TCNSJobPendingOutcome => ({
            outcome,
            jobGroup: jobState.jobGroup,
            startedAt: attempt.startedAt,
            settledAt: now,
            started: true,
            error,
        });
        const directive = run.directive;

        if (directive?.kind === 'snooze') {
            return pending({ ...base, kind: 'requeue', attemptStatus: 'snoozed', runAfter: now + directive.delayMs });
        }
        if (directive?.kind === 'throttle') {
            const nextStartAt = now + directive.delayMs;
            return pending({
                ...base,
                kind: 'requeue',
                attemptStatus: 'snoozed',
                runAfter: nextStartAt,
                throttle: { jobGroup: directive.scope === 'group' ? jobState.jobGroup : undefined, nextStartAt },
            });
        }
        if (run.timeoutError) return this.failure(run, run.timeoutError.name, run.timeoutError);
        if (directive?.kind === 'fail') return this.failure(run, directive.errorName, thrown);
        if (returned) return pending({ ...base, kind: 'completed', result: returned.value });
        if (run.abortReason === 'stop') {
            return pending({ ...base, kind: 'requeue', attemptStatus: 'aborted', runAfter: now }, thrown);
        }
        if (run.abortReason === 'cancel') {
            return pending({ ...base, kind: 'final', attemptStatus: 'cancelled', finalStatus: 'cancelled' }, thrown);
        }
        return this.failure(run, CNSJobErrorName.of(thrown), thrown);
    }

    private failure(run: TCNSJobRunningAttempt, errorName: string, error: unknown): TCNSJobPendingOutcome {
        const { jobState, attempt } = run;
        const now = this.now();
        const decision = CNSJobRetryPolicy.decide({
            attempts: this.closeLast(jobState.attempts, 'failed'),
            retry: jobState.retry ?? this.handlers.get(jobState.jobType)?.definition.retry,
            attemptStatus: 'failed',
            errorName,
            now,
            random: this.random,
        });
        const base = {
            jobId: jobState.jobId,
            seq: jobState.seq,
            attemptNumber: attempt.attemptNumber,
            errorName,
            attemptMeta: Object.keys(run.attemptMeta).length > 0 ? run.attemptMeta : undefined,
        };
        return {
            outcome:
                decision.kind === 'requeue'
                    ? { ...base, kind: 'requeue', attemptStatus: 'failed', runAfter: decision.runAfter }
                    : { ...base, kind: 'final', attemptStatus: 'failed', finalStatus: 'failed' },
            jobGroup: jobState.jobGroup,
            startedAt: attempt.startedAt,
            settledAt: now,
            started: true,
            error,
        };
    }

    private closeLast(attempts: readonly TCNSJobAttempt[], status: ECNSJobAttemptStatus): TCNSJobAttempt[] {
        const last = CNSJobAttempts.last(attempts);
        return last ? [...attempts.slice(0, -1), { ...last, status }] : [...attempts];
    }

    private buildContext(run: TCNSJobRunningAttempt): TCNSJobRunContext {
        const { jobState, attempt } = run;
        return {
            jobState,
            attempt,
            abortSignal: run.controller.signal,
            attemptMeta: {
                set: (key, value) => {
                    run.attemptMeta[key] = value;
                },
            },
            saveState: async state => {
                if (!this.holdsLease(run)) return false;
                const saved = await this.repository.stateRepository.save(jobState.jobId, jobState.seq, attempt.attemptNumber, state);
                if (saved) this.events.emit({ name: 'attempt.stateSaved', jobId: jobState.jobId, seq: jobState.seq, jobType: jobState.jobType, attempt });
                return saved;
            },
            log: (kind, entry) => {
                const stored = CNSJobJsonValue.copy(entry);
                if (!this.holdsLease(run)) return;
                run.logs.push({ attemptNumber: attempt.attemptNumber, seq: ++run.logSeq, at: this.now(), kind, entry: stored });
                this.logging.add(run);
                this.scheduleFlush(this.finishBatchMs);
            },
            snooze: delayMs => {
                run.directive = { kind: 'snooze', delayMs };
            },
            throttle: (delayMs, scope) => {
                if (scope === 'group' && jobState.jobGroup === undefined) {
                    throw new Error(`[@cnstra/jobs] job "${jobState.jobId}" has no jobGroup to throttle`);
                }
                run.directive = { kind: 'throttle', delayMs, scope };
            },
            fail: errorName => {
                run.directive = { kind: 'fail', errorName };
            },
        };
    }

    private submit(pending: TCNSJobPendingOutcome): void {
        const run = this.running.get(CNSJobCompositeKey.of(pending.outcome.jobId, pending.outcome.seq, pending.outcome.attemptNumber));
        if (run) run.submitted = true;
        this.outcomes.push(pending);
        this.scheduleFlush(this.finishBatchMs);
    }

    private scheduleFlush(delayMs: number): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flush();
        }, delayMs);
    }

    private flush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (this.flushing) {
            this.flushAgain = true;
            return this.flushing;
        }
        this.flushing = (async () => {
            do {
                this.flushAgain = false;
                await this.flushLogs();
                await this.flushOutcomes();
            } while (this.flushAgain);
        })().finally(() => {
            this.flushing = undefined;
        });
        return this.flushing;
    }

    private lostLease(run: TCNSJobRunningAttempt): boolean {
        return run.abortReason === 'leaseLost';
    }

    private holdsLease(run: TCNSJobRunningAttempt): boolean {
        return !run.submitted && this.leaseValid(run);
    }

    private leaseValid(run: TCNSJobRunningAttempt): boolean {
        return this.leaseLeftMs(run) > 0;
    }

    private logsMayHoldOutcome(run: TCNSJobRunningAttempt): boolean {
        return this.leaseLeftMs(run) > this.pollIntervalMs + this.leaseMs / 3;
    }

    private leaseLeftMs(run: TCNSJobRunningAttempt): number {
        if (this.lostLease(run) || run.jobState.lockedUntil === undefined) return 0;
        return run.jobState.lockedUntil - this.now();
    }

    private async flushLogs(): Promise<void> {
        const runs = [...this.logging];
        this.logging.clear();
        for (const run of runs) {
            const entries = run.logs;
            run.logs = [];
            if (entries.length === 0 || !this.leaseValid(run)) continue;
            try {
                await this.repository.logRepository.append(run.jobState.jobId, entries);
            } catch (error) {
                this.onError(error);
                if (run.submitted && !this.logsMayHoldOutcome(run)) continue;
                run.logs = [...entries, ...run.logs];
                this.logging.add(run);
                if (this.status === 'running') this.scheduleFlush(this.pollIntervalMs);
            }
        }
    }

    private async flushOutcomes(): Promise<void> {
        const logging = new Set(
            [...this.logging]
                .filter(run => this.status === 'running' && run.logs.length > 0 && this.logsMayHoldOutcome(run))
                .map(run => CNSJobCompositeKey.of(run.jobState.jobId, run.jobState.seq, run.attempt.attemptNumber))
        );
        const waitingForLogs = (pending: TCNSJobPendingOutcome) =>
            logging.has(CNSJobCompositeKey.of(pending.outcome.jobId, pending.outcome.seq, pending.outcome.attemptNumber));
        const batch = this.outcomes.filter(pending => !waitingForLogs(pending));
        if (batch.length === 0) return;
        this.outcomes = this.outcomes.filter(waitingForLogs);
        const requests = this.status === 'running' ? this.reserveRequests() : [];
        let result: TCNSJobTransitionResult;
        try {
            result = await this.repository.finish(
                batch.map(pending => pending.outcome),
                requests.length > 0 ? { requests, workerId: this.workerId } : undefined
            );
        } catch (error) {
            this.onError(error);
            const retried = error instanceof CNSJobUnstorableOutcomeError ? batch.map(pending => this.failUnstorable(pending, error)) : batch;
            this.outcomes = [...retried, ...this.outcomes];
            if (retried.some((pending, index) => pending !== batch[index])) this.flushAgain = true;
            else if (this.status === 'running') this.scheduleFlush(this.pollIntervalMs);
            return;
        } finally {
            this.unreserve(requests);
        }
        this.accept(result, batch);
        void this.pump();
    }

    private failUnstorable(pending: TCNSJobPendingOutcome, error: CNSJobUnstorableOutcomeError): TCNSJobPendingOutcome {
        const { outcome } = pending;
        if (pending.error instanceof CNSJobUnstorableOutcomeError) return pending;
        const rejected = error.outcome;
        if (outcome.jobId !== rejected.jobId || outcome.seq !== rejected.seq || outcome.attemptNumber !== rejected.attemptNumber) return pending;
        return {
            ...pending,
            error,
            outcome: {
                jobId: outcome.jobId,
                seq: outcome.seq,
                attemptNumber: outcome.attemptNumber,
                kind: 'final',
                attemptStatus: 'failed',
                finalStatus: 'failed',
                errorName: error.name,
            },
        };
    }

    private emitTransitions(transitions: readonly TCNSJobTransition[], pending: readonly TCNSJobPendingOutcome[]): void {
        const byAttempt = new Map(
            pending.map(item => [CNSJobCompositeKey.of(item.outcome.jobId, item.outcome.seq, item.outcome.attemptNumber), item])
        );
        for (const transition of transitions) {
            const item =
                transition.attemptNumber === undefined
                    ? undefined
                    : byAttempt.get(CNSJobCompositeKey.of(transition.jobId, transition.seq, transition.attemptNumber));
            const common = { jobId: transition.jobId, seq: transition.seq, jobType: transition.jobType, jobGroup: item?.jobGroup };
            if (item) {
                const outcome = item.outcome;
                const cancelled = transition.finalStatus === 'cancelled' || transition.finalStatus === 'superseded';
                const status: ECNSJobAttemptStatus =
                    outcome.kind === 'completed' ? 'completed' : cancelled ? 'cancelled' : outcome.attemptStatus;
                const name = ATTEMPT_EVENTS[status];
                if (name && item.started) this.events.emit({ ...common, name, durationMs: item.settledAt - item.startedAt, error: item.error });
                if (outcome.throttle) this.events.emit({ ...common, name: 'throttle.paused' });
                if (outcome.kind === 'requeue' && (outcome.attemptStatus === 'failed' || outcome.attemptStatus === 'stale')) {
                    this.events.emit({ ...common, name: 'job.delayed' });
                }
            }
            if (transition.finalStatus) this.events.emit({ ...common, name: CNSJobEventNames.finished(transition.finalStatus) });
        }
    }

    private async renew(): Promise<void> {
        const leased = [...this.running.values()].filter(
            run => !run.submitted && run.abortReason !== 'timeout' && run.abortReason !== 'leaseLost'
        );
        if (leased.length === 0) return;
        try {
            const renewedAt = this.now();
            const result = await this.repository.renew(
                leased.map(run => ({ jobId: run.jobState.jobId, seq: run.jobState.seq, attemptNumber: run.attempt.attemptNumber, leaseMs: this.leaseMs }))
            );
            const runKey = (run: TCNSJobRunningAttempt) => CNSJobCompositeKey.of(run.jobState.jobId, run.jobState.seq, run.attempt.attemptNumber);
            const leaseKey = (lease: TCNSJobLease) => CNSJobCompositeKey.of(lease.jobId, lease.seq, lease.attemptNumber);
            const lost = new Set(result.lostLeases.map(leaseKey));
            for (const run of leased) {
                if (!lost.has(runKey(run))) {
                    run.jobState.lockedUntil = renewedAt + this.leaseMs;
                    continue;
                }
                if (run.submitted) continue;
                this.abort(run, 'leaseLost', new Error('job lease lost'));
                run.abortReason = 'leaseLost';
                run.logs = [];
                this.events.emit({ name: 'attempt.leaseLost', jobId: run.jobState.jobId, seq: run.jobState.seq, jobType: run.jobState.jobType, attempt: run.attempt });
            }
            for (const { lease } of result.cancelRequests) {
                const run = this.running.get(leaseKey(lease));
                if (run) this.abort(run, 'cancel', new Error('job cancelled'));
            }
        } catch (error) {
            this.onError(error);
        }
    }

    private promoteSoon(): void {
        if (this.status !== 'running') return;
        if (this.promoting) {
            this.promoteAgain = true;
            return;
        }
        this.promoting = this.promote().finally(() => {
            this.promoting = undefined;
            if (!this.promoteAgain) return;
            this.promoteAgain = false;
            this.promoteSoon();
        });
    }

    private async promote(): Promise<void> {
        const startDeadlineMs: Record<string, number> = {};
        for (const [jobType, handler] of this.handlers) {
            if (handler.definition.startDeadlineMs !== undefined) startDeadlineMs[jobType] = handler.definition.startDeadlineMs;
        }
        try {
            const result = await this.repository.promote(this.jobTypes(), startDeadlineMs);
            this.emitTransitions(result.transitions, []);
            if (result.readyJobIds.length > 0) void this.pump();
        } catch (error) {
            this.onError(error);
        }
    }

    private async maintain(): Promise<void> {
        const jobTypes = this.jobTypes();
        await this.attempt(() => this.recoverStale(jobTypes));
        await this.attempt(async () => {
            const repaired = await this.repository.repairKeys(jobTypes);
            if (repaired.length > 0) this.events.emit({ name: 'maintenance.unblocked', count: repaired.length });
        });
        await this.attempt(async () => {
            const retention: Record<string, TCNSJobRetentionPolicy> = {};
            for (const [jobType, handler] of this.handlers) {
                if (handler.definition.retention) retention[jobType] = handler.definition.retention;
            }
            const removed = await this.repository.maintain(retention, await this.dedupWindowMs(jobTypes), this.historyHorizonMs);
            if (removed.length === 0) return;
            this.events.emit({ name: 'maintenance.swept', count: removed.length });
        });
        await this.attempt(() => this.enqueueScheduleSlots());
        await this.flush();
    }

    private async attempt(step: () => Promise<void>): Promise<void> {
        try {
            await step();
        } catch (error) {
            this.onError(error);
        }
    }

    private async recoverStale(jobTypes: readonly string[]): Promise<void> {
        const now = this.now();
        for (const jobState of await this.repository.takeStale(jobTypes)) {
            const attempt = CNSJobAttempts.last(jobState.attempts);
            if (!attempt) continue;
            const ownRun = this.running.get(CNSJobCompositeKey.of(jobState.jobId, jobState.seq, attempt.attemptNumber));
            if (ownRun?.timeoutError) {
                if (!ownRun.submitted) this.submit(this.failure(ownRun, ownRun.timeoutError.name, ownRun.timeoutError));
                continue;
            }
            if (ownRun) continue;
            const decision = CNSJobRetryPolicy.decide({
                attempts: this.closeLast(jobState.attempts, 'stale'),
                retry: jobState.retry ?? this.handlers.get(jobState.jobType)?.definition.retry,
                attemptStatus: 'stale',
                now,
                random: this.random,
            });
            const base = { jobId: jobState.jobId, seq: jobState.seq, attemptNumber: attempt.attemptNumber };
            this.submit({
                outcome:
                    decision.kind === 'requeue'
                        ? { ...base, kind: 'requeue', attemptStatus: 'stale', runAfter: decision.runAfter }
                        : { ...base, kind: 'final', attemptStatus: 'stale', finalStatus: 'failed' },
                jobGroup: jobState.jobGroup,
                startedAt: attempt.startedAt,
                settledAt: this.now(),
                started: true,
            });
        }
    }

    private async syncSchedules(): Promise<void> {
        const known = await this.repository.listSchedules(this.jobTypes());
        for (const [jobType, handler] of this.handlers) {
            const schedules = handler.definition.schedules ?? [];
            const declared = new Set(schedules.map(schedule => schedule.scheduleId));
            const dropped = known
                .filter(schedule => schedule.jobType === jobType && schedule.fromDefinition && !declared.has(schedule.scheduleId))
                .map(schedule => schedule.scheduleId);
            if (dropped.length > 0) await this.repository.removeSchedules(jobType, dropped);
            if (schedules.length > 0) await this.repository.upsertSchedules(jobType, schedules, true);
        }
    }

    private async enqueueScheduleSlots(): Promise<void> {
        const now = this.now();
        const until = now + this.maintenanceIntervalMs;
        const requests: TCNSJobEnqueueRequest[] = [];
        const cursors = new Map<string, number>();
        for (const schedule of await this.repository.listSchedules(this.jobTypes())) {
            const cursorKey = schedule.scheduleId;
            const after = this.scheduleCursors.get(cursorKey) ?? now - this.scheduleCatchUpMs - 1;
            this.scheduleCursors.set(cursorKey, after);
            let slots: number[];
            try {
                slots = CNSJobScheduleSlots.list(schedule, after, until);
            } catch (error) {
                this.onError(error);
                continue;
            }
            const definition = this.handlers.get(schedule.jobType)?.definition;
            for (const slot of slots) {
                requests.push(
                    CNSJobEnqueueRequestBuilder.build(
                        {
                            payload: undefined,
                            ...schedule.template,
                            jobType: schedule.jobType,
                            jobId: CNSJobScheduleSlots.buildJobId(schedule.scheduleId, slot),
                            runAfter: slot,
                        },
                        definition
                    )
                );
            }
            if (slots.length > 0) cursors.set(cursorKey, slots[slots.length - 1]);
        }
        if (requests.length === 0) return;
        const results = await this.repository.enqueue(
            requests.map(request => ({ ...request, idempotencyWindowMs: undefined }))
        );
        cursors.forEach((slot, cursorKey) => this.scheduleCursors.set(cursorKey, slot));
        results.forEach((result, index) => {
            const job = requests[index].job;
            CNSJobEnqueueEvents.emitLeft(this.events, job, result);
            if (result.status !== 'inserted') return;
            this.events.emit({ name: 'job.enqueued', jobId: result.jobId, jobType: job.jobType, jobGroup: job.jobGroup });
        });
    }
}
