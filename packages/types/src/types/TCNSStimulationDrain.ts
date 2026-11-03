import { ICNSStimulation } from '../interfaces/ICNSStimulation';

/**
 * Announced when a stimulation's synchronous turn ends — the batch boundary — or, for a turn inside `cns.batch`, when that batch ends.
 *
 * It is a property of the scheduler loop exhausting, not of an activation
 * finishing, so it cannot be derived from `onResponse`: a turn also ends when the
 * last activation returned a promise, when a concurrency limit is reached, on
 * abort, and behind an async listener. Fires once per turn, the final one
 * included.
 *
 * The counters mean what they do on `TCNSStimulationResponse`, but measured after
 * the loop exhausted — so a non-zero `pendingActivations` here is blocked, not
 * about to run.
 */
export type TCNSStimulationDrain = {
    stimulation: ICNSStimulation<any, any>;
    /** `pendingActivations + activeActivations`. Zero means the stimulation is finished. */
    queueLength: number;
    /** Activations whose dendrite response has not been invoked. Non-zero here means blocked. */
    pendingActivations: number;
    /** Activations awaiting an unsettled promise. Non-zero means another drain is coming. */
    activeActivations: number;
};
