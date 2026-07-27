import type { TCNSSignalRef } from './TCNSSignalRef';
import type { TCNSStimulationTaskStatus } from './TCNSStimulationTaskStatus';

/**
 * A settled task in its **emit** form — a neuron activation with its input **inline**
 * (`TCNSSignalRef`). The producer emits inline because it does not yet know the
 * per-stimulation ordinals; the durable layer assigns the `index` and dedupes the
 * inline input into {@link TCNSStimulationTaskPersisted.inputIndex} on persist.
 */
export type TCNSStimulationTaskDto = {
    /** Always present — a task is a neuron activation (resolve-or-throw). */
    neuronName: string;
    dendriteCollateralName: string;
    /** The input signal that drove this task (inline; deduped to a ref on persist). */
    input: TCNSSignalRef;
    /** Payload this task produced, if any. */
    output: TCNSSignalRef | null;
    status: TCNSStimulationTaskStatus;
    error: string | null;
    startedAt: number;
    duration: number | null;
};
