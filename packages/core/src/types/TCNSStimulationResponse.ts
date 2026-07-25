import { TCNSSignal } from './TCNSSignal';
import { CNSStimulation } from '../CNSStimulation';
import { TCNSModality } from './TCNSModality';
import { TCNSAfferentPath } from './TCNSAfferentPath';
import { CNSCollateral } from '../CNSCollateral';

export type TCNSStimulationResponse<
    TInputCollateral extends CNSCollateral<unknown> = CNSCollateral<unknown>,
    TOutputCollateral extends CNSCollateral<unknown> = CNSCollateral<unknown>
> = {
    inputSignal?: TCNSSignal<TInputCollateral>;
    outputSignal?: TCNSSignal<TOutputCollateral>;
    modality?: TCNSModality;
    afferentPath?: TCNSAfferentPath;
    contextValue: Map<object, unknown>;
    /**
     * Every activation this stimulation still owns, in any state:
     * `pendingActivations + activeActivations`.
     *
     * The unit is an activation - one `TCNSNeuronActivationTask`, i.e. one
     * (neuron, dendrite, signal) triple. A single signal produces one activation
     * per subscriber of its collateral.
     *
     * Active activations are counted deliberately: the queue owns work that has
     * been handed to a neuron but not finished, the same way an AMQP queue counts
     * unacknowledged messages in its total. `getAllActivationTasks()` follows the
     * same model.
     *
     * `queueLength === 0` means the stimulation is finished - it is the exact
     * condition used internally to settle `waitUntilComplete()`, so it holds on
     * the terminal response and nowhere else.
     *
     * NOT a synchronous-batch boundary. A response is emitted when an activation
     * finishes, but a batch can also end when one *starts* and goes async, and no
     * response is emitted at that moment. Use `onDrain` for batch boundaries.
     */
    queueLength: number;
    /**
     * Activations that exist (or are reserved) but whose dendrite body has not
     * been invoked yet: waiting in the ring buffer, created and held before being
     * enqueued, or reserved by an array fan-out that is still mid-dispatch.
     *
     * Subscribers parked behind an async `onResponse` listener are counted here,
     * not in {@link activeActivations}: the split is by lifecycle stage - whether
     * the body has started - not by whether something is being awaited.
     */
    pendingActivations: number;
    /**
     * Activations whose dendrite body has been invoked and returned a promise
     * that has not settled.
     *
     * A synchronous body passes through this state within a single pump
     * iteration and is decremented before its response is emitted, so only
     * genuinely asynchronous activations are ever observed here.
     */
    activeActivations: number;
    // Reference to the stimulation instance for lazy access to activation tasks
    stimulation: CNSStimulation<any, any>;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;
};
