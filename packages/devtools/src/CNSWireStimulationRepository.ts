import type {
    ICNSStimulationWriter,
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
} from '@cnstra/persist';
import type { CNSDTOAppBatchItem } from '@cnstra/devtools-dto';

/**
 * Producer-side {@link ICNSStimulationWriter} that turns every write from a
 * {@link CNSStimulationPersistor} into a name-based batch item and enqueues it on the
 * devtools transport. This is how the devtools emit the SAME durable run/attempt/task
 * model used for resume — no bespoke id/inputIndex logic in the devtools.
 *
 * It is WRITE-ONLY by construction: implementing only `ICNSStimulationWriter` means
 * there are no query methods to stub. `getStimulation` returns `undefined` — the
 * persistor calls it on flush to carry a Clone's original `entry` across attempts, but
 * on the producer there is no read store and every attempt is fresh, so `undefined` is
 * correct. The read/list/timeline surface lives on the server store.
 */
export class CNSWireStimulationRepository implements ICNSStimulationWriter {
    constructor(private readonly send: (item: CNSDTOAppBatchItem) => void) {}

    async saveStimulation(
        stimulation: TCNSStimulationPersisted
    ): Promise<void> {
        this.send({ type: 'cns.stimulation', data: stimulation });
    }

    async saveAttempt(attempt: TCNSStimulationAttemptPersisted): Promise<void> {
        this.send({ type: 'cns.stimulation.attempt', data: attempt });
    }

    async appendTask(task: TCNSStimulationTaskPersisted): Promise<void> {
        this.send({ type: 'cns.stimulation.task', data: task });
    }

    async getStimulation(): Promise<TCNSStimulationPersisted | undefined> {
        return undefined;
    }
}
