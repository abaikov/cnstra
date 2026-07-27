import type { ICNSStimulationRepository } from './interfaces/ICNSStimulationRepository';
import type {
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
} from '@cnstra/persist-dto';

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
 * the reference implementation. Not durable across a restart; use a Postgres/Redis
 * adapter for production. Stimulations are keyed by `stimulationId`, attempts by
 * `stimulationAttemptId`, tasks bucketed per attempt.
 *
 * Retention is bounded via {@link TCNSInMemoryStimulationRepositoryOptions} — pass
 * `maxStimulations`, `ttlMs`, and/or `deleteOnComplete` so `observe`-style use does
 * not leak. With no options it is unbounded (fine for tests, NOT for a long-running app).
 */
export class CNSInMemoryStimulationRepository
    implements ICNSStimulationRepository
{
    private readonly stimulations = new Map<string, TCNSStimulationPersisted>();
    private readonly attempts = new Map<
        string,
        TCNSStimulationAttemptPersisted
    >();
    private readonly tasks = new Map<string, TCNSStimulationTaskPersisted[]>();
    /** stimulationId → last-write epoch ms, for TTL + LRU eviction. */
    private readonly updatedAt = new Map<string, number>();

    constructor(
        private readonly options: TCNSInMemoryStimulationRepositoryOptions = {}
    ) {}

    async saveStimulation(
        stimulation: TCNSStimulationPersisted
    ): Promise<void> {
        this.stimulations.set(stimulation.stimulationId, stimulation);
        this.touch(stimulation.stimulationId);
        this.sweep();
    }

    async saveAttempt(attempt: TCNSStimulationAttemptPersisted): Promise<void> {
        this.attempts.set(attempt.stimulationAttemptId, attempt);
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

    async appendTask(task: TCNSStimulationTaskPersisted): Promise<void> {
        const bucket = this.tasks.get(task.stimulationAttemptId);
        if (bucket) bucket.push(task);
        else this.tasks.set(task.stimulationAttemptId, [task]);
    }

    async getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationPersisted | undefined> {
        return this.stimulations.get(stimulationId);
    }

    async listStimulations(filter?: {
        scopeName?: string;
    }): Promise<TCNSStimulationPersisted[]> {
        // Newest-first (no timestamps in the model — storage owns time; insertion
        // order reversed is the in-memory proxy).
        const all = [...this.stimulations.values()].reverse();
        if (filter?.scopeName === undefined) return all;
        return all.filter(s => s.scopeName === filter.scopeName);
    }

    async getAttempts(
        stimulationId: string
    ): Promise<TCNSStimulationAttemptPersisted[]> {
        return [...this.attempts.values()]
            .filter(a => a.stimulationId === stimulationId)
            .sort((a, b) => a.attemptNumber - b.attemptNumber);
    }

    async getTasks(
        stimulationAttemptId: string
    ): Promise<TCNSStimulationTaskPersisted[]> {
        return this.tasks.get(stimulationAttemptId) ?? [];
    }

    async delete(stimulationId: string): Promise<void> {
        this.purge(stimulationId);
    }

    // ── bounds ──

    private touch(stimulationId: string): void {
        // Re-insert so Map iteration order is least-recently-updated first.
        this.updatedAt.delete(stimulationId);
        this.updatedAt.set(stimulationId, Date.now());
    }

    /** Remove a stimulation and everything under it. */
    private purge(stimulationId: string): void {
        this.stimulations.delete(stimulationId);
        this.updatedAt.delete(stimulationId);
        for (const [id, a] of this.attempts) {
            if (a.stimulationId === stimulationId) {
                this.attempts.delete(id);
                this.tasks.delete(id);
            }
        }
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
        }
        if (maxStimulations != null) {
            // updatedAt iterates least-recently-updated first → evict from the front.
            while (this.stimulations.size > maxStimulations) {
                const oldest = this.updatedAt.keys().next().value;
                if (oldest === undefined) break;
                this.purge(oldest);
            }
        }
    }
}
