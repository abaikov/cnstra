import type { TCNSSignalRef } from './TCNSSignalRef';
import type { TCNSStimulationStatus } from './TCNSStimulationStatus';

/**
 * A stimulation attempt in its **emit** form — what a producer reports as it runs,
 * before the durable layer assigns identity. Same observable facts as
 * {@link TCNSStimulationAttemptPersisted} minus the assigned `stimulationAttemptId` /
 * `stimulationId` / `attemptNumber` (and `replayOf`, which is persist-side
 * provenance).
 */
export type TCNSStimulationAttemptDto = {
    status: TCNSStimulationStatus;
    startedAt: number;
    completedAt: number | null;
    hopCount: number;
    hasError: boolean;
    /** The signal(s) this attempt was activated with; slots `0..k-1`. */
    entry: TCNSSignalRef[];
};
