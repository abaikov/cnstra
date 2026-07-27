import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * Write side of the durable-execution layer. Wire its `onResponse` into a run
 * (`cns.stimulate(sig, { onResponse })` / `cns.activate(tasks, { onResponse })`).
 * As the run advances it keeps the run's `progress` (frontier + context) current
 * for resume, and — when the volume is `'full'` — appends settled tasks as history
 * rows, updating the attempt and run status. Cadence is delegated to a
 * {@link ICNSProgressRecordingStrategy}; volume to {@link TCNSStimulationVolume}.
 *
 * It never deletes the run — record lifecycle (cleanup on success, retention for the
 * retry UI) is the integration's concern. Supersedes the narrower
 * {@link CNSProgressRecorder} (progress-only) once implemented.
 */
export interface ICNSStimulationPersistor {
    /** Feed each stimulation response through the recorder. */
    readonly onResponse: (response: TCNSStimulationResponse) => void;
    /** Flush/cancel any pending cadence timer. */
    dispose(): void;
}
