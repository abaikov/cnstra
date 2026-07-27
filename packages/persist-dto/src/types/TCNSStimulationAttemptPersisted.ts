import type { TCNSSignalRef } from './TCNSSignalRef';
import type { TCNSStimulationStatus } from './TCNSStimulationStatus';

/**
 * One **attempt** — a single execution of a stimulation (one `cns.stimulate` or
 * `cns.activate`). New attempt ⇒ new `stimulationAttemptId` + `attemptNumber++`;
 * closed attempts are immutable. `(stimulationId, attemptNumber)` is unique;
 * `stimulationAttemptId` is its own global id (the heir of today's devtools
 * stimulation id, now minted durably).
 *
 * `entry` is the input **set** this attempt was activated with — one signal for a
 * fresh stimulation, the whole frontier for a resume — occupying index slots
 * `0..k-1` that a persisted task's `inputIndex` can point at.
 */
export type TCNSStimulationAttemptPersisted = {
    stimulationAttemptId: string;
    stimulationId: string;
    attemptNumber: number;
    status: TCNSStimulationStatus;
    startedAt: number;
    completedAt: number | null;
    hopCount: number;
    hasError: boolean;
    /** Explicit fork provenance: the `stimulationAttemptId` this attempt was forked from, if any. */
    replayOf: string | null;
    /** The signal(s) this attempt was activated with; slots `0..k-1`. */
    entry: TCNSSignalRef[];
};
