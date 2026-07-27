import type {
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
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
    saveStimulation(stimulation: TCNSStimulationPersisted): Promise<void>;
    /** Upsert one attempt marker. */
    saveAttempt(attempt: TCNSStimulationAttemptPersisted): Promise<void>;
    /** Append one settled history task (full volume only; append-only). */
    appendTask(task: TCNSStimulationTaskPersisted): Promise<void>;
    /** Load a stimulation — for resume (its `progress`) and Clone (its `entry`). */
    getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationPersisted | undefined>;
}

/**
 * The READ side — what resume (`getStimulation` → progress) and the retry UI
 * (list / timeline / waterfall) call.
 */
export interface ICNSStimulationReader {
    getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationPersisted | undefined>;
    /** List stimulations (newest-first), for the retry UI. Optionally scope-filtered. */
    listStimulations(filter?: {
        scopeName?: string;
    }): Promise<TCNSStimulationPersisted[]>;
    /** The attempt timeline of a stimulation. */
    getAttempts(
        stimulationId: string
    ): Promise<TCNSStimulationAttemptPersisted[]>;
    /** The task waterfall of one attempt (empty when volume was `'progress'`). */
    getTasks(
        stimulationAttemptId: string
    ): Promise<TCNSStimulationTaskPersisted[]>;
}

/**
 * Durable store for the stimulation/attempt/task model — the full read+write seam
 * (in-memory, Postgres, "inside the queue job", …), so the durable-execution layer
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
