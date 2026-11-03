import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

/**
 * The WRITE side of the stimulation store — exactly what
 * {@link ICNSStimulationPersistor} needs as a stimulation advances: the upserts,
 * plus `getStimulation` (it reads back a Clone's original `entry` on flush).
 *
 * Segregated from the read side so a write-only target — e.g. the devtools
 * `CNSWireStimulationRepository`, which streams to a socket and has nothing to
 * read back — implements only this, instead of stubbing query methods it can't
 * serve.
 */
export interface ICNSStimulationWriter {
    /** Upsert a stimulation: its identity, status, and current progress (resume state). */
    saveStimulation(stimulation: TCNSStimulationState): Promise<void>;
    /** Upsert one attempt marker. */
    saveAttempt(attempt: TCNSStimulationAttempt): Promise<void>;
    /** Append one settled history task (full volume only; append-only). */
    appendTask(task: TCNSStimulationTask): Promise<void>;
    /** Load a stimulation — for resume (its `progress`) and Clone (its `entry`). */
    getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationState | undefined>;
}

/**
 * The READ side — what resume (`getStimulation` → progress) and the retry UI
 * (list / timeline / waterfall) call.
 */
export interface ICNSStimulationReader {
    getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationState | undefined>;
    /**
     * List stimulations (newest-first), for the retry UI. Optionally
     * scope-filtered.
     *
     * `since` is a PRUNE, not the filter: a store may drop runs it can cheaply
     * prove are older, and must not drop anything else. Ignoring it is correct,
     * only slower — the caller applies the real predicate either way. It exists
     * because the roster derivation reads every attempt and task of every run it
     * is handed, and a store that can narrow the set first saves all of that.
     */
    listStimulations(filter?: {
        scopeName?: string;
        since?: number;
    }): Promise<TCNSStimulationState[]>;
    /** The attempt timeline of a stimulation. */
    getAttempts(
        stimulationId: string
    ): Promise<TCNSStimulationAttempt[]>;
    /** The task waterfall of one attempt (empty when volume was `'progress'`). */
    getTasks(
        stimulationAttemptId: string
    ): Promise<TCNSStimulationTask[]>;

    /**
     * The attempts of MANY stimulations at once.
     *
     * The panel's snapshot draws a page of runs with their attempts and tasks. Per
     * run that is one call, then one per attempt — a page of 200 runs turns into
     * hundreds of round trips, and the cost grows with the page rather than with
     * the data. These two exist so it is one call each.
     *
     * Optional: a store that does not implement them is driven by the per-id
     * methods above, which is correct, only slower.
     */
    getAttemptsFor?(
        stimulationIds: readonly string[]
    ): Promise<TCNSStimulationAttempt[]>;
    /** The tasks of MANY attempts at once — see {@link getAttemptsFor}. */
    getTasksFor?(
        stimulationAttemptIds: readonly string[]
    ): Promise<TCNSStimulationTask[]>;
}

/**
 * Resumable store for the stimulation/attempt/task model — the full read+write seam
 * (in-memory, Postgres, "inside the queue job", …), so the resumable-execution layer
 * never depends on a particular database or queue. Composed from the segregated
 * {@link ICNSStimulationWriter} + {@link ICNSStimulationReader}; record lifecycle
 * (creation, TTL, cleanup) is the integration's concern — e.g. `delete` tied to a
 * completed queue job.
 */
export interface ICNSStimulationRepository
    extends ICNSStimulationWriter,
        ICNSStimulationReader {
    delete(stimulationId: string): Promise<void>;
}
