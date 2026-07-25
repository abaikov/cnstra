import { CNSStimulation } from '../CNSStimulation';

/**
 * Announced when a stimulation's synchronous turn ends: everything reachable
 * without yielding to the event loop has run, and what remains (if anything) is
 * waiting on a promise or blocked by a concurrency limit.
 *
 * This is the batch boundary. It is a property of the scheduler loop exhausting,
 * not of any individual activation starting or finishing - which is why it cannot
 * be derived from `onResponse`. A turn ends in six ways, and a response is only
 * emitted in the first:
 *
 *   1. an activation finished and left the queue empty
 *   2. the last activation *started* and returned a promise
 *   3. the stimulation-level `concurrency` limit was reached
 *   4. the stimulation was aborted
 *   5. subscribers are parked behind an async `onResponse` listener
 *   6. a per-neuron `setConcurrency` gate forced an activation onto a promise
 *
 * Fires exactly once per turn, including the final one - so a listener that
 * flushes on every drain needs no separate completion handling.
 *
 * The counters carry the same meaning as on `TCNSStimulationResponse`, but they
 * are measured *after* the loop exhausted rather than before the work runs. On a
 * response `pendingActivations` is a forecast; here it is a fact, and a non-zero
 * value can only mean blocked - by a concurrency limit or by an abort - never
 * "about to run".
 */
export type TCNSStimulationDrain = {
    stimulation: CNSStimulation<any, any>;
    /** `pendingActivations + activeActivations`. Zero means the stimulation is finished. */
    queueLength: number;
    /** Activations whose dendrite body has not been invoked. Non-zero here means blocked. */
    pendingActivations: number;
    /** Activations awaiting an unsettled promise. Non-zero means another drain is coming. */
    activeActivations: number;
};
