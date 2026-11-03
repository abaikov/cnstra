import { TCNSContextStore } from './TCNSContextStore';
import { TCNSModality } from './TCNSModality';
import { TCNSAfferentPath } from './TCNSAfferentPath';
import { TCNSStimulationDrain } from './TCNSStimulationDrain';

export type TCNSStimulationOptions<TResponse> = {
    maxNeuronHops?: number;
    onResponse?: (response: TResponse) => void | Promise<void>;
    /**
     * Called once at the end of every synchronous turn - see
     * {@link TCNSStimulationDrain}. This is the batch boundary for integrations
     * that commit accumulated writes (state managers, in-memory databases).
     *
     * Returns `void` by design: a returned promise is not awaited. There is
     * nothing to gate on - the next turn is started by someone else's promise
     * settling, so awaiting here would only delay the callback. For asynchronous
     * work at a boundary use `onResponse`, which does support promises.
     *
     * Re-entrant calls are safe. A nested `stimulate()` is a separate stimulation
     * and announces its own boundary inline - that is the supported way to react
     * to a drain. Feeding work back into the *same* stimulation via
     * `enqueueTasks()` runs it, but folds it into the turn that is already
     * closing, so it produces no additional boundary of its own.
     */
    onDrain?: (drain: TCNSStimulationDrain) => void;
    abortSignal?: AbortSignal;
    concurrency?: number;
    modality?: TCNSModality;
    afferentPath?: TCNSAfferentPath;
    /**
     * Data attached to the whole run, in namespaced compartments — the same
     * object on every hop. Its per-activation sibling is `activationContext`.
     *
     * What is portable travels with the serialized frontier, so a run resumed in
     * another process reads back what the previous attempt left here.
     */
    stimulationContext?: TCNSContextStore;
};
