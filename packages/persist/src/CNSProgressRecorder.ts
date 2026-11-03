import type { ICNSStimulation, TCNSStimulationResponse } from '@cnstra/types';
import { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';
import type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
import type { TCNSProgressRecorderOptions } from './types/TCNSProgressRecorderOptions';

/**
 * Records just the outstanding frontier, into a KV {@link ICNSProgressRepository}
 * — the only shape a store like BullMQ's native job progress can hold.
 *
 * {@link CNSStimulationPersistor} is the sibling that writes the full
 * run/attempt/task model instead. Both share the serializer and the cadence
 * strategy; they differ in what the store can keep.
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
