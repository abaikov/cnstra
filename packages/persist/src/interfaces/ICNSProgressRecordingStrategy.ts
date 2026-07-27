import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * Decides **when** progress is persisted. Fed each stimulation response by the
 * {@link CNSProgressRecorder}; it calls the provided `flush` when it wants a write
 * to happen (flush serializes the current outstanding frontier and saves it).
 *
 * Implement this for custom persistence cadence; the default is
 * {@link CNSDebouncedProgressRecordingStrategy}.
 */
export interface ICNSProgressRecordingStrategy {
    /** Called for each response; invoke `flush()` to persist now. */
    onResponse(response: TCNSStimulationResponse, flush: () => void): void;
    /** Cancel any pending timers. */
    dispose(): void;
}
