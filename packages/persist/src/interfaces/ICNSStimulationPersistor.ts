import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * Write side of the resumable-execution layer. Wire its `onResponse` into a run
 * (`cns.stimulate(sig, { onResponse })` / `cns.activate(tasks, { onResponse })`).
 * As the run advances it keeps the run's `progress` (the outstanding frontier) current
 * for resume, and — when the volume is `'full'` — appends settled tasks as history
 * rows, updating the attempt and run status. Cadence is delegated to a
 * {@link ICNSProgressRecordingStrategy}; volume to {@link ECNSStimulationVolume}.
 *
 * It never deletes the run — record lifecycle (cleanup on success, retention for the
 * retry UI) is the integration's concern. Supersedes the narrower
 * {@link CNSProgressRecorder} (progress-only) once implemented.
 */
export interface ICNSStimulationPersistor {
    /** Feed each stimulation response through the recorder. */
    /**
     * Feed each stimulation response through the recorder.
     *
     * Returning a promise is meaningful: the engine awaits it and holds this
     * hop's subscribers until it settles. That is how `barrier` turns the
     * recorder into a per-hop checkpoint gate.
     */
    readonly onResponse: (
        response: TCNSStimulationResponse
    ) => void | Promise<void>;
    /**
     * Cancel any pending cadence timer and resolve when the outstanding writes
     * have landed. Await it before starting the next attempt of the same run;
     * ignore it and nothing changes for you.
     */
    dispose(): Promise<void>;
}
