import type { ICNSStimulationRepository } from './interfaces/ICNSStimulationRepository';
import type { ICNSStimulationRosterQuery } from './interfaces/ICNSStimulationRosterQuery';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterFacets,
} from '@cnstra/persist-dto';
import {
    loadCNSRosterEntries,
    keysetPage,
    computeCNSRosterFacets,
} from './CNSStimulationRosterCompute';

/**
 * Bounds for the in-memory store — WITHOUT one it grows forever (every run's
 * attempts + tasks retained), which will OOM a long-running process. Set at least
 * one for anything but a short-lived test.
 */
export type TCNSInMemoryStimulationRepositoryOptions = {
    /**
     * Cap on retained stimulations. When exceeded, the least-recently-updated are
     * evicted (with their attempts + tasks). Unset ⇒ unbounded.
     */
    maxStimulations?: number;
    /**
     * Evict a stimulation whose last write was more than this many ms ago. Swept
     * lazily on each write (no timers). Unset ⇒ no TTL.
     */
    ttlMs?: number;
    /**
     * Drop a stimulation (and its attempts + tasks) the moment it reaches a terminal
     * status (`completed` or `failed`) — for a "live runs only, retain nothing" worker
     * where memory must stay flat. Off by default. To KEEP failed runs (to inspect or
     * Retry) while still bounding memory, use `maxStimulations` / `ttlMs` instead.
     */
    deleteOnComplete?: boolean;
};

/**
 * In-memory {@link ICNSStimulationRepository} — for tests, single-process dev, and
 * the reference implementation. Not resumable across a restart; use a Postgres/Redis
 * adapter for production. Stimulations are keyed by `stimulationId`, attempts by
 * `stimulationAttemptId`, tasks bucketed per attempt.
 *
 * Retention is bounded via {@link TCNSInMemoryStimulationRepositoryOptions} — pass
 * `maxStimulations`, `ttlMs`, and/or `deleteOnComplete` so `observe`-style use does
 * not leak. With no options it is unbounded (fine for tests, NOT for a long-running app).
 */
export class CNSInMemoryStimulationRepository
    implements ICNSStimulationRepository, ICNSStimulationRosterQuery
{
    private readonly stimulations = new Map<string, TCNSStimulationState>();
    private readonly attempts = new Map<
        string,
        TCNSStimulationAttempt
    >();
    private readonly tasks = new Map<string, TCNSStimulationTask[]>();
    /** stimulationId → last-write epoch ms, for TTL + LRU eviction. */
    private readonly updatedAt = new Map<string, number>();
    /**
     * stimulationAttemptId → owning stimulationId, and its inverse. Task buckets are
     * keyed by attempt, so without this a bucket is only reachable through the attempt
     * ROW — and a bucket written after that row was evicted would leak forever.
     */
    private readonly stimulationByAttempt = new Map<string, string>();
    private readonly attemptIdsByStimulation = new Map<string, Set<string>>();
    /**
     * Task buckets with no known owner yet, → last-write epoch ms (insertion order =
     * least-recently-written first). Tasks legitimately precede the first (debounced)
     * attempt flush, and a run can be evicted mid-flight, so a bucket can exist with no
     * attempt row to hang it off. Bounded on its own until an attempt adopts it.
     */
    private readonly orphanTaskBuckets = new Map<string, number>();

    constructor(
        private readonly options: TCNSInMemoryStimulationRepositoryOptions = {}
    ) {}

    async saveStimulation(
        stimulation: TCNSStimulationState
    ): Promise<void> {
        this.stimulations.set(stimulation.stimulationId, stimulation);
        this.touch(stimulation.stimulationId);
        this.sweep();
    }

    async saveAttempt(attempt: TCNSStimulationAttempt): Promise<void> {
        this.attempts.set(attempt.stimulationAttemptId, attempt);
        this.own(attempt.stimulationAttemptId, attempt.stimulationId);
        this.touch(attempt.stimulationId);
        // Terminal flush writes saveStimulation THEN saveAttempt, so this is the last
        // write of a settled run — a safe point to drop it whole when requested.
        if (
            this.options.deleteOnComplete &&
            attempt.completedAt != null &&
            (attempt.status === 'completed' || attempt.status === 'failed')
        ) {
            this.purge(attempt.stimulationId);
            return;
        }
        this.sweep();
    }

    async appendTask(task: TCNSStimulationTask): Promise<void> {
        const attemptId = task.stimulationAttemptId;
        const bucket = this.tasks.get(attemptId);
        if (bucket) bucket.push(task);
        else this.tasks.set(attemptId, [task]);

        const stimulationId = this.stimulationByAttempt.get(attemptId);
        if (stimulationId !== undefined) {
            // A task write IS activity on the run — without this a long run whose
            // attempt flushes are debounced looks least-recently-updated and gets
            // evicted mid-flight.
            this.touch(stimulationId);
        } else {
            // No owner to purge this bucket: hold it in the orphan set so the
            // configured bounds still reach it.
            this.orphanTaskBuckets.delete(attemptId);
            this.orphanTaskBuckets.set(attemptId, Date.now());
        }
        this.sweep();
    }

    async getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationState | undefined> {
        return this.stimulations.get(stimulationId);
    }

    async listStimulations(filter?: {
        scopeName?: string;
        since?: number;
    }): Promise<TCNSStimulationState[]> {
        // Newest-first (no timestamps in the model — storage owns time; insertion
        // order reversed is the in-memory proxy).
        const all = [...this.stimulations.values()].reverse();
        const scoped =
            filter?.scopeName === undefined
                ? all
                : all.filter(s => s.scopeName === filter.scopeName);
        if (filter?.since === undefined) return scoped;

        // `since` is a PRUNE, not the filter. A run's `startedAt` is the minimum
        // over its attempts and is only known after they have been read, which is
        // the work this exists to avoid — so the prune uses the last write
        // instead. A write always follows the start, so `updatedAt >= since` is a
        // superset of `startedAt >= since`: nothing that belongs in the window is
        // dropped, and the caller's own predicate still decides.
        //
        // There is no matching prune for `until`: a run that started before it
        // may well have been written after it.
        const since = filter.since;
        return scoped.filter(
            s => (this.updatedAt.get(s.stimulationId) ?? 0) >= since
        );
    }

    async getAttempts(
        stimulationId: string
    ): Promise<TCNSStimulationAttempt[]> {
        // Through the ownership index, not a scan of every attempt: the roster
        // derivation asks this once per run, so a scan makes it quadratic.
        const ids = this.attemptIdsByStimulation.get(stimulationId);
        if (!ids) return [];
        const out: TCNSStimulationAttempt[] = [];
        for (const id of ids) {
            const attempt = this.attempts.get(id);
            if (attempt) out.push(attempt);
        }
        return out.sort((a, b) => a.attemptNumber - b.attemptNumber);
    }

    async getTasks(
        stimulationAttemptId: string
    ): Promise<TCNSStimulationTask[]> {
        return this.tasks.get(stimulationAttemptId) ?? [];
    }

    /**
     * Attempts of many stimulations at once. In memory this saves no round trip,
     * but implementing it keeps the reference store on the same path the panel
     * takes against a real one — so a regression there shows up here too.
     */
    async getAttemptsFor(
        stimulationIds: readonly string[]
    ): Promise<TCNSStimulationAttempt[]> {
        const out: TCNSStimulationAttempt[] = [];
        for (const id of stimulationIds) out.push(...(await this.getAttempts(id)));
        return out;
    }

    /** Tasks of many attempts at once — see {@link getAttemptsFor}. */
    async getTasksFor(
        stimulationAttemptIds: readonly string[]
    ): Promise<TCNSStimulationTask[]> {
        const out: TCNSStimulationTask[] = [];
        for (const id of stimulationAttemptIds)
            out.push(...(this.tasks.get(id) ?? []));
        return out;
    }

    async delete(stimulationId: string): Promise<void> {
        this.purge(stimulationId);
    }

    // ── roster query capability (the reference derivation, over itself) ──

    async queryRoster(
        filter: TCNSStimulationRosterFilter,
        opts: { cursor?: string; sinceCursor?: string; limit: number }
    ): Promise<TCNSStimulationRosterPage> {
        const entries = await loadCNSRosterEntries(this, filter);
        return keysetPage(
            entries.map(e => e.row),
            opts
        );
    }

    async queryFacets(
        filter: TCNSStimulationRosterFilter,
        opts?: { metricPath?: string }
    ): Promise<TCNSStimulationRosterFacets> {
        const entries = await loadCNSRosterEntries(this, filter);
        return computeCNSRosterFacets(entries, opts);
    }

    // ── bounds ──

    /**
     * Retained task buckets (one per attempt id, including not-yet-owned ones).
     * Exposed read-only so retention can be asserted; not part of the repository
     * contract.
     */
    get taskBucketCount(): number {
        return this.tasks.size;
    }

    private touch(stimulationId: string): void {
        // Re-insert so Map iteration order is least-recently-updated first.
        this.updatedAt.delete(stimulationId);
        this.updatedAt.set(stimulationId, Date.now());
    }

    /** Record which stimulation an attempt (and so its task bucket) belongs to. */
    private own(stimulationAttemptId: string, stimulationId: string): void {
        this.stimulationByAttempt.set(stimulationAttemptId, stimulationId);
        let ids = this.attemptIdsByStimulation.get(stimulationId);
        if (!ids) {
            ids = new Set();
            this.attemptIdsByStimulation.set(stimulationId, ids);
        }
        ids.add(stimulationAttemptId);
        // Adopted — the run's own bounds cover it from here on.
        this.orphanTaskBuckets.delete(stimulationAttemptId);
    }

    /** Remove a stimulation and everything under it. */
    private purge(stimulationId: string): void {
        this.stimulations.delete(stimulationId);
        this.updatedAt.delete(stimulationId);
        // Drive off the ownership index, not the attempt rows: a bucket whose attempt
        // row was never written (tasks precede the first flush) is unreachable by a
        // scan of `attempts`, and would survive its own run's eviction.
        const attemptIds = this.attemptIdsByStimulation.get(stimulationId);
        if (attemptIds) {
            for (const id of attemptIds) {
                this.attempts.delete(id);
                this.tasks.delete(id);
                this.stimulationByAttempt.delete(id);
            }
            this.attemptIdsByStimulation.delete(stimulationId);
        }
    }

    /** Drop a task bucket that no stimulation claims. */
    private purgeOrphanBucket(stimulationAttemptId: string): void {
        this.orphanTaskBuckets.delete(stimulationAttemptId);
        this.tasks.delete(stimulationAttemptId);
    }

    /** Lazy TTL + max-size eviction, run on writes. */
    private sweep(): void {
        const { ttlMs, maxStimulations } = this.options;
        if (ttlMs != null) {
            const cutoff = Date.now() - ttlMs;
            for (const [id, at] of this.updatedAt) {
                if (at < cutoff) this.purge(id);
                else break; // updatedAt is in ascending order — the rest are newer
            }
            for (const [id, at] of this.orphanTaskBuckets) {
                if (at < cutoff) this.purgeOrphanBucket(id);
                else break; // same ascending order
            }
        }
        if (maxStimulations != null) {
            // updatedAt iterates least-recently-updated first → evict from the front.
            while (this.stimulations.size > maxStimulations) {
                const oldest = this.updatedAt.keys().next().value;
                if (oldest === undefined) break;
                this.purge(oldest);
            }
            // An unowned bucket is a run's tasks with no run row (yet, or ever again),
            // so it answers to the same cap rather than growing without one.
            while (this.orphanTaskBuckets.size > maxStimulations) {
                const oldest = this.orphanTaskBuckets.keys().next().value;
                if (oldest === undefined) break;
                this.purgeOrphanBucket(oldest);
            }
        }
    }
}
