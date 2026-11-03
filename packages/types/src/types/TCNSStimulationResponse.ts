import { TCNSSignal } from './TCNSSignal';
import { ICNSStimulation } from '../interfaces/ICNSStimulation';
import { TCNSModality } from './TCNSModality';
import { TCNSAfferentPath } from './TCNSAfferentPath';
import { ICNSCollateral } from '../interfaces/ICNSCollateral';
import { TCNSNeuron } from './TCNSNeuron';
import { TCNSNeuronActivationTask } from './TCNSNeuronActivationTask';
import { TCNSContextStore } from './TCNSContextStore';

export type TCNSStimulationResponse<
    TInputCollateral extends ICNSCollateral<unknown> = ICNSCollateral<unknown>,
    TOutputCollateral extends ICNSCollateral<unknown> = ICNSCollateral<unknown>
> = {
    inputSignal?: TCNSSignal<TInputCollateral>;
    outputSignal?: TCNSSignal<TOutputCollateral>;
    modality?: TCNSModality;
    afferentPath?: TCNSAfferentPath;
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
     * Activations that exist (or are reserved) but whose dendrite response has
     * not been invoked yet: waiting in the ring buffer, created and held before being
     * enqueued, or reserved by an array fan-out that is still mid-dispatch.
     *
     * Subscribers parked behind an async `onResponse` listener are counted here,
     * not in {@link activeActivations}: the split is by lifecycle stage - whether
     * the response has started - not by whether something is being awaited.
     */
    pendingActivations: number;
    /**
     * Activations whose dendrite response has been invoked and returned a promise
     * that has not settled.
     *
     * A synchronous body passes through this state within a single pump
     * iteration and is decremented before its response is emitted, so only
     * genuinely asynchronous activations are ever observed here.
     */
    activeActivations: number;
    // Reference to the stimulation instance for lazy access to activation tasks
    stimulation: ICNSStimulation<any, any>;

    /**
     * The neuron that produced this response (present on both the success and the
     * throw path). Enables name-based consumers (persist, devtools) to resolve the
     * task's neuron reliably — including for sink/failed tasks that have no output
     * collateral to trace an owner from.
     */
    neuron?: TCNSNeuron<any>;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;

    /**
     * When the activation's dendrite response was invoked, in epoch milliseconds.
     *
     * Present for real neuron activations on every path — success, sync throw and
     * async rejection alike. Absent on responses that are not an activation (the
     * entry-signal injection, and the terminal signal emitted on abort).
     */
    startedAt?: number;
    /**
     * How long the dendrite response took, in milliseconds: the span from
     * {@link startedAt} to the moment the activation settled.
     *
     * This is the only place per-hop latency exists — it is what a trace needs to
     * draw a waterfall and what a metrics layer needs for a latency histogram.
     * Present exactly when {@link startedAt} is.
     */
    duration?: number;

    /**
     * The activations this response is about to create — built, but not yet run.
     *
     * The engine resolves the subscribers of the output collateral and builds
     * their tasks BEFORE handing the response to a listener, then enqueues those
     * very objects afterwards — on the synchronous path, after an async listener
     * settles, and even after a listener throws. So a listener can write into
     * `task.activationContext` here and the dendrite will read it back as
     * `ctx.activationContext`.
     *
     * Empty on a response that starts nothing: a sink neuron, a failure, the
     * entry injection with no subscribers, the terminal abort signal.
     */
    scheduledActivationTasks?: readonly TCNSNeuronActivationTask<any>[];

    /**
     * The context store of the activation that produced this response — the same
     * object its own handler reads as `ctx.activationContext`.
     *
     * Here so a recorder can put it in the task's history row without holding the
     * task itself. Undefined when nothing was attached, and on responses that are
     * not an activation.
     */
    activationContext?: TCNSContextStore;
};
