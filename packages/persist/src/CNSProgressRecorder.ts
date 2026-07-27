import type { ICNSStimulation, TCNSStimulationResponse } from '@cnstra/types';
import { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';
import type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
import type { TCNSProgressRecorderOptions } from './types/TCNSProgressRecorderOptions';

/**
 * Records a stimulation's progress into a repository, on a cadence decided by a
 * {@link ICNSProgressRecordingStrategy}. Wire its `onResponse` into the run:
 *
 * ```ts
 * const recorder = new CNSProgressRecorder({ serializer, repository, key: jobId });
 * cns.stimulate(signal, { onResponse: recorder.onResponse });
 * // ...on teardown: recorder.dispose();
 * ```
 *
 * It never deletes the record — the record's lifecycle (cleanup on success,
 * retention for an admin UI) is the integration's concern (e.g. tied to the
 * pg-boss job row).
 *
 * The FRONTIER-only, KV-shaped sibling of {@link CNSStimulationPersistor}: same
 * serializer + strategy machinery, but it saves one {@link TCNSProgress} blob to a
 * minimal {@link ICNSProgressRepository} (the only shape some checkpoints — e.g.
 * BullMQ's native job-progress — can hold). Reach for the persistor instead when the
 * store can hold the full relational run/attempt/task model.
 */
export class CNSProgressRecorder {
    private readonly strategy: ICNSProgressRecordingStrategy;

    constructor(private readonly options: TCNSProgressRecorderOptions) {
        this.strategy =
            options.strategy ?? new CNSDebouncedProgressRecordingStrategy();
    }

    readonly onResponse = (response: TCNSStimulationResponse): void => {
        this.strategy.onResponse(response, () => {
            void this.flush(response.stimulation);
        });
    };

    private async flush(stimulation: ICNSStimulation<any>): Promise<void> {
        const progress = this.options.serializer.serialize(stimulation);
        await this.options.repository.save(this.options.key, progress);
    }

    dispose(): void {
        this.strategy.dispose();
    }
}
