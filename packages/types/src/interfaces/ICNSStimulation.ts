import type { TCNSNeuron } from '../types/TCNSNeuron';
import type { TCNSDendrite } from '../types/TCNSDendrite';
import type { TCNSNeuronActivationTask } from '../types/TCNSNeuronActivationTask';
import type { TCNSNeuronActivationTaskFailure } from '../types/TCNSNeuronActivationTaskFailure';

/**
 * The public contract of a running stimulation, as seen by consumers (via the
 * return of `stimulate`/`activate` and `response.stimulation`). The concrete
 * `CNSStimulation` class in `@cnstra/core` implements it; internal enqueue/dispatch
 * methods are intentionally not part of the public interface.
 */
export interface ICNSStimulation<
    TNeuron extends TCNSNeuron<any>,
    TDendrite extends TCNSDendrite<any, any> = TCNSDendrite<any, any>
> {
    /** Resolves when the run completes; rejects on failed tasks / abort. */
    waitUntilComplete(): Promise<void>;
    /** All activation tasks seen this run. */
    getAllActivationTasks(): TCNSNeuronActivationTask<TNeuron>[];
    /** Tasks that failed or were aborted. */
    getFailedTasks(): Array<TCNSNeuronActivationTaskFailure<TNeuron>>;
    /**
     * The current outstanding frontier — not-yet-completed tasks (queued, active,
     * pending) plus failed/aborted ones. The set to persist for resume.
     */
    getOutstandingTasks(): TCNSNeuronActivationTask<TNeuron>[];
}
