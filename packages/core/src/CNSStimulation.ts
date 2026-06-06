import { CNSStimulationContextStore } from './CNSStimulationContextStore';
import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';
import { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { CNSInstanceNeuronQueue } from './CNSInstanceNeuronQueue';
import { TCNSSignal } from './types/TCNSSignal';
import { TCNSNeuronActivationTask } from './types/TCNSNeuronActivationTask';
import { CNS } from './CNS';
import { ICNS } from './interfaces/ICNS';
import { TCNSNeuronActivationTaskFailure } from './types/TCNSNeuronActivationTaskFailure';
import { TCNSStimulationResponse } from './types/TCNSStimulationResponse';
import { CNSCollateral } from './CNSCollateral';
import { TNCNeuronResponseReturn } from './types/TCNSNeuronResponseReturn';
import { TCNSAxon } from './types/TCNSAxon';

/**
 * Internal, non-enumerable cache of the resolved dendrite on activation tasks we
 * create ourselves. Lets executeActivationTask skip the subscriber lookup on the
 * hot path. Tasks supplied externally via activate() simply lack it and fall
 * back to the lookup. Symbol-keyed so it never shows up in JSON/spread/keys.
 */
const TASK_DENDRITE = Symbol('cnstra.taskDendrite');

/**
 * Per-activation context handed to a dendrite's `response`. Implemented as a
 * class so get/set/delete live once on the prototype and each activation
 * allocates a single object instead of an object plus three closures.
 *
 * NOTE: methods rely on `this`; call them as `ctx.get()` (not destructured).
 */
class CNSDendriteContext {
    constructor(
        public readonly stimulation: any,
        private readonly neuron: any,
        public readonly abortSignal: AbortSignal | undefined,
        public readonly cns: any
    ) {}
    get(): unknown {
        return this.stimulation.getContext().get(this.neuron);
    }
    set(value: unknown): void {
        this.stimulation.getContext().set(this.neuron, value);
    }
    delete(): void {
        this.stimulation.getContext().delete(this.neuron);
    }
}

/**
 * Response object handed to onResponse listeners. Implemented as a class so the
 * `contextValue` accessor lives once on the prototype (not re-created per
 * response) and instances share a single monomorphic hidden class. `contextValue`
 * is computed lazily: cloning the context Map is the heaviest part of the
 * response and most listeners never read it.
 */
class CNSStimulationResponseImpl {
    constructor(
        public readonly stimulation: CNSStimulation<any, any>,
        private readonly store: ICNSStimulationContextStore | undefined,
        public readonly inputSignal: TCNSSignal<CNSCollateral<unknown>> | undefined,
        public readonly outputSignal:
            | TCNSSignal<CNSCollateral<unknown>>
            | undefined,
        public readonly queueLength: number,
        public readonly hops: number | undefined,
        public readonly error: any
    ) {}

    get contextValue(): Map<object, unknown> {
        return this.store ? this.store.getAll() : new Map();
    }
}

export class CNSStimulation<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {
    // Lazily allocated: most stimulations never touch neuron context, so we
    // avoid allocating the store object (and its Map) until something reads or
    // writes it. An externally supplied store (options.ctx) is kept eagerly.
    private ctxStore?: ICNSStimulationContextStore;

    // --- Inlined activation queue (formerly CNSNeuronActivationPump) ---
    // Folded into the stimulation so a single run allocates one object instead
    // of also spinning up a separate pump object + its backing array.
    // Ring buffer; the backing array is allocated lazily on first enqueue.
    private qItems?: Array<TCNSNeuronActivationTask<TNeuron> | undefined>;
    private qHead = 0;
    private qTail = 0;
    private qSize = 0;
    private qCapacity = 4;
    private activeOperations = 0;
    // Lazily allocated: only populated while an async task is in flight; purely
    // synchronous stimulations never need it.
    private activeTasks?: Set<TCNSNeuronActivationTask<TNeuron>>;
    // Re-entrancy guard for the pump loop.
    private pumping = false;
    private needsPump = false;

    private readonly neuronVisitMap?: Map<TNeuron, number>;
    private readonly instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>;
    private scheduledCount = 0;
    // Lazily allocated: only needed while subscriber tasks wait for an async
    // onResponse to resolve before being enqueued.
    private pendingTasks?: Set<TCNSNeuronActivationTask<TNeuron>>;
    // Lazily allocated: only allocated when a task actually fails.
    private failedTasks?: Array<TCNSNeuronActivationTaskFailure<TNeuron>>;
    // Completion is tracked eagerly via flags; the Promise is only materialized
    // if someone actually calls waitUntilComplete(). This avoids allocating a
    // Promise (the single most expensive setup cost) on every stimulate().
    private completed?: Promise<void>;
    private resolveCompleted?: () => void;
    private rejectCompleted?: (e: any) => void;
    private isCompleted = false;
    private completionError: any;
    private completionRejected = false;
    private onResponseError: Error | undefined;

    /**
     * The (already wrapped) response listener for this stimulation, or
     * undefined when there is neither a local nor any global listener.
     */
    private readonly onResponse?: (
        response: TCNSStimulationResponse
    ) => void | Promise<void>;

    /**
     * Track active SCCs: SCC index -> count of active neurons in that SCC.
     * Only allocated when context auto-cleanup is enabled.
     */
    private readonly activeSccCounts?: Map<number, number>;

    constructor(
        public readonly cns: CNS<TNeuron, TDendrite>,
        instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>,
        public readonly options?: TCNSStimulationOptions<TCNSStimulationResponse>,
        onResponse?: (
            response: TCNSStimulationResponse
        ) => void | Promise<void>
    ) {
        // Keep an externally supplied store eagerly; otherwise defer creation.
        this.ctxStore = options?.ctx;

        this.instanceNeuronQueue = instanceNeuronQueue;
        this.onResponse = onResponse;

        if (this.options?.maxNeuronHops) {
            this.neuronVisitMap = new Map();
        }

        if (this.autoCleanupContextsEnabled) {
            this.activeSccCounts = new Map();
        }
    }

    private pushFailedTask(
        failure: TCNSNeuronActivationTaskFailure<TNeuron>
    ): void {
        (this.failedTasks ??= []).push(failure);
    }

    private finalizeResolve(): void {
        this.completionRejected = false;
        this.resolveCompleted?.();
    }

    private finalizeReject(error: any): void {
        this.completionRejected = true;
        this.completionError = error;
        this.rejectCompleted?.(error);
    }

    /** Lazily-created neuron context store (see {@link ctxStore}). */
    private get ctx(): ICNSStimulationContextStore {
        return (this.ctxStore ??= new CNSStimulationContextStore());
    }

    // ----- Inlined activation queue / pump -----

    private get canStartOperation(): boolean {
        const limit = this.options?.concurrency ?? Infinity;
        return (
            this.activeOperations < limit &&
            !this.options?.abortSignal?.aborted
        );
    }

    private qResize(): void {
        const oldCapacity = this.qCapacity;
        const oldItems = this.qItems!;
        this.qCapacity = oldCapacity * 2;
        const newItems = new Array(this.qCapacity);

        let oldIndex = this.qHead;
        for (let i = 0; i < this.qSize; i++) {
            newItems[i] = oldItems[oldIndex];
            oldIndex = (oldIndex + 1) % oldCapacity;
        }

        this.qItems = newItems;
        this.qHead = 0;
        this.qTail = this.qSize;
    }

    private qDequeue(): TCNSNeuronActivationTask<TNeuron> | undefined {
        if (this.qSize === 0) return undefined;
        const items = this.qItems!;
        const task = items[this.qHead];
        items[this.qHead] = undefined; // Clear reference
        this.qHead = (this.qHead + 1) % this.qCapacity;
        this.qSize--;
        return task;
    }

    private qEnqueueItem(task: TCNSNeuronActivationTask<TNeuron>): void {
        if (!this.qItems) {
            this.qItems = new Array(this.qCapacity);
        } else if (this.qSize === this.qCapacity) {
            this.qResize();
        }
        this.qItems[this.qTail] = task;
        this.qTail = (this.qTail + 1) % this.qCapacity;
        this.qSize++;
    }

    /** Enqueue a task and drive the pump unless one is already running. */
    private qEnqueue(task: TCNSNeuronActivationTask<TNeuron>): void {
        this.qEnqueueItem(task);
        if (!this.pumping) this.pump();
        else this.needsPump = true;
    }

    private qGetQueuedTasks(): TCNSNeuronActivationTask<TNeuron>[] {
        const result: TCNSNeuronActivationTask<TNeuron>[] = [];
        if (!this.qItems) return result;
        let index = this.qHead;
        for (let i = 0; i < this.qSize; i++) {
            result.push(this.qItems[index]!);
            index = (index + 1) % this.qCapacity;
        }
        return result;
    }

    private pump(): void {
        if (this.pumping) {
            this.needsPump = true;
            return;
        }
        this.pumping = true;

        while (this.canStartOperation && this.qSize > 0) {
            const task = this.qDequeue()!;
            this.activeOperations++;

            const ret = this.executeActivationTask(task);

            // Async branch
            if (ret && typeof (ret as any).then === 'function') {
                // Only track tasks that are actually in flight across a tick;
                // synchronous tasks complete before anyone can observe them.
                (this.activeTasks ??= new Set()).add(task);
                (ret as Promise<void | (() => void)>).then(
                    cb => {
                        this.activeOperations--;
                        this.activeTasks!.delete(task);
                        if (typeof cb === 'function') cb();

                        if (this.qSize > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                    },
                    err => {
                        this.activeOperations--;
                        this.activeTasks!.delete(task);
                        if (this.qSize > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                        throw err; // let it crash "honestly"
                    }
                );
                // Do not break: if concurrency allows, start additional items
                continue;
            }

            // Sync branch (task was never added to activeTasks)
            this.activeOperations--;
            if (typeof ret === 'function') (ret as () => void)();
        }

        this.pumping = false;

        // If async completions or enqueues requested another pass, do exactly
        // one more, non-recursively.
        if (this.needsPump) {
            this.needsPump = false;
            this.pump();
        }
    }

    private tryResolveCompleted(): void {
        if (this.isCompleted) return;
        const noActive = this.activeOperations === 0;
        const noPending = this.qSize + this.scheduledCount === 0;
        const aborted = !!this.options?.abortSignal?.aborted;

        if ((noPending && noActive) || (aborted && noActive && !noPending)) {
            // When completing due to abort, mark all remaining queued tasks as aborted
            if (aborted) {
                const queuedTasks = this.qGetQueuedTasks();

                for (const task of [...queuedTasks]) {
                    const alreadyTracked = this.failedTasks?.some(
                        ft => ft.task === task
                    );
                    if (!alreadyTracked) {
                        this.pushFailedTask({
                            task,
                            error: new Error(
                                'Task aborted - not started due to abort signal'
                            ),
                            aborted: true,
                        });
                    }
                }

                this.isCompleted = true;
                this.finalizeReject(new Error('Stimulation aborted'));
                return;
            }

            this.isCompleted = true;
            // If there are failed tasks or onResponse error, reject the promise
            // Otherwise resolve it
            const failedCount = this.failedTasks?.length ?? 0;
            if (failedCount > 0 || this.onResponseError) {
                const error =
                    this.onResponseError ||
                    new Error(
                        `Stimulation completed with ${failedCount} failed task(s)`
                    );
                this.finalizeReject(error);
            } else {
                this.finalizeResolve();
            }
        }
    }

    public waitUntilComplete(): Promise<void> {
        if (this.completed) return this.completed;
        // Already completed before anyone awaited: hand back a settled promise.
        if (this.isCompleted) {
            this.completed = this.completionRejected
                ? Promise.reject(this.completionError)
                : Promise.resolve();
            return this.completed;
        }
        // Materialize the promise now and capture its resolvers for later.
        this.completed = new Promise<void>((resolve, reject) => {
            this.resolveCompleted = resolve;
            this.rejectCompleted = reject;
        });
        return this.completed;
    }

    /**
     * Returns all current activation tasks: queued, active, and pending (scheduled but not yet enqueued)
     */
    public getAllActivationTasks(): TCNSNeuronActivationTask<TNeuron>[] {
        const queuedTasks = this.qGetQueuedTasks();
        const activeTasks = (this.activeTasks ? Array.from(this.activeTasks) : []);
        const pendingTasks = this.pendingTasks
            ? Array.from(this.pendingTasks)
            : [];
        return [...queuedTasks, ...activeTasks, ...pendingTasks];
    }

    /**
     * Returns all tasks that failed or were aborted
     */
    public getFailedTasks(): Array<TCNSNeuronActivationTaskFailure<TNeuron>> {
        return this.failedTasks ? [...this.failedTasks] : [];
    }

    /**
     * Get the context store for this stimulation
     */
    public getContext(): ICNSStimulationContextStore {
        return this.ctx;
    }

    /**
     * Enqueue activation tasks directly into the stimulation queue
     */
    public enqueueTasks(
        tasks: TCNSNeuronActivationTask<TNeuron>[]
    ): void {
        for (const task of tasks) {
            this.qEnqueue(task);
        }
        this.tryResolveCompleted();
    }

    protected get concurrencyEnabled(): boolean {
        return (
            this.options?.concurrency !== undefined &&
            this.options?.concurrency > 0
        );
    }

    protected get autoCleanupContextsEnabled(): boolean {
        return this.cns?.options?.autoCleanupContexts ?? false;
    }

    /**
     * Mark a neuron as active (being processed)
     */
    protected markNeuronActive(neuron: TNeuron): void {
        if (!this.autoCleanupContextsEnabled) return;

        this.incrementSccCount(neuron);
    }

    /**
     * Mark a neuron as inactive (finished processing)
     */
    protected markNeuronInactive(neuron: TNeuron): void {
        if (!this.autoCleanupContextsEnabled) return;

        this.decrementSccCount(neuron);
    }

    /**
     * Increment the active count for the SCC containing this neuron
     */
    private incrementSccCount(neuron: TNeuron): void {
        const counts = this.activeSccCounts;
        if (!counts) return;
        const sccIndex = this.cns.network.getSccIndexByNeuron(neuron);
        if (sccIndex === undefined) return;

        const currentCount = counts.get(sccIndex) || 0;
        counts.set(sccIndex, currentCount + 1);
    }

    /**
     * Decrement the active count for the SCC containing this neuron
     */
    private decrementSccCount(neuron: TNeuron): void {
        const counts = this.activeSccCounts;
        if (!counts) return;
        const sccIndex = this.cns.network.getSccIndexByNeuron(neuron);
        if (sccIndex === undefined) return;

        const currentCount = counts.get(sccIndex) || 0;
        const nextCount = Math.max(0, currentCount - 1);
        counts.set(sccIndex, nextCount);

        // Log warning if we're trying to decrement below 0
        if (currentCount === 0) {
            console.warn(
                `[CNSStimulation] Attempting to decrement SCC count below 0 for neuron`
            );
        }
    }

    /**
     * Check if a neuron can be guaranteed not to be visited again
     */
    protected canNeuronBeGuaranteedDone(neuron: TNeuron): boolean {
        if (!this.autoCleanupContextsEnabled || !this.activeSccCounts)
            return false;
        return this.cns.network.canNeuronBeGuaranteedDone(
            neuron,
            this.activeSccCounts
        );
    }

    protected cleanupCtxIfNeeded(neuron: TNeuron): void {
        if (
            this.autoCleanupContextsEnabled &&
            this.canNeuronBeGuaranteedDone(neuron)
        ) {
            // Nothing to clean if no context was ever stored.
            this.ctxStore?.delete(neuron);
        }
    }

    protected createSubscriberQueueItem(
        subscriber: TCNSSubscriber<TNeuron, TDendrite>,
        inputSignal?: TCNSSignal<CNSCollateral<unknown>>
    ) {
        if (this.options?.maxNeuronHops) {
            if (
                (this.neuronVisitMap?.get(subscriber.neuron) ?? 0) >=
                this.options?.maxNeuronHops
            ) {
                throw new Error(
                    `Max neuron hops reached when trying to enqueue subscriber`
                );
            } else {
                this.neuronVisitMap?.set(
                    subscriber.neuron,
                    (this.neuronVisitMap?.get(subscriber.neuron) ?? 0) + 1
                );
            }
        }

        const neuronActivationTask: TCNSNeuronActivationTask<TNeuron> = {
            neuron: subscriber.neuron,
            dendriteCollateral: subscriber.dendrite.collateral as CNSCollateral<unknown>,
            input: inputSignal,
        };
        // Cache the resolved subscriber so executeActivationTask can skip the
        // lookup (invisible to JSON/spread thanks to the Symbol key).
        (neuronActivationTask as any)[TASK_DENDRITE] = subscriber;
        return neuronActivationTask;
    }

    private executeActivationTask(
        neuronActivationTask: TCNSNeuronActivationTask<TNeuron>
    ) {
        // Fast path: tasks we created carry their resolved subscriber. Tasks
        // supplied externally via activate() don't, so fall back to a lookup.
        let subscriber = (neuronActivationTask as any)[TASK_DENDRITE] as
            | TCNSSubscriber<TNeuron, TDendrite>
            | undefined;
        if (!subscriber) {
            const subscribers = this.cns.network.getSubscribers(
                neuronActivationTask.dendriteCollateral
            );
            for (let i = 0; i < subscribers.length; i++) {
                if (subscribers[i].neuron === neuronActivationTask.neuron) {
                    subscriber = subscribers[i];
                    break;
                }
            }
        }
        if (!subscriber) {
            // Task failed: subscriber not found
            this.pushFailedTask({
                task: neuronActivationTask,
                error: new Error(
                    `Subscriber not found for activation task`
                ),
                aborted: false,
            });
            return () => {};
        }

        const neuron = subscriber.neuron;
        const dendrite = subscriber.dendrite as TDendrite;

        const inputSignal = neuronActivationTask.input;

        // Fast path: with no per-neuron concurrency limit there is nothing to
        // gate, so run inline instead of allocating a starter thunk and going
        // through the queue.
        const concurrency = (neuron as { concurrency?: number }).concurrency;
        if (concurrency === undefined || concurrency <= 0) {
            return this.runStarter(
                neuron,
                dendrite,
                inputSignal,
                neuronActivationTask
            );
        }
        return this.instanceNeuronQueue.run(neuron, () =>
            this.runStarter(
                neuron,
                dendrite,
                inputSignal,
                neuronActivationTask
            )
        );
    }

    private runStarter(
        neuron: TNeuron,
        dendrite: TDendrite,
        inputSignal: TCNSSignal<CNSCollateral<unknown>> | undefined,
        neuronActivationTask: TCNSNeuronActivationTask<TNeuron>
    ): (() => void) | Promise<() => void> {
        // Mark neuron as active only when we actually start processing (after gate allows it)
        this.markNeuronActive(neuron);

        let response: TNCNeuronResponseReturn<TCNSAxon>;
        try {
            response = dendrite.response(
                inputSignal?.payload,
                neuron.axon,
                new CNSDendriteContext(
                    this,
                    neuron,
                    this.options?.abortSignal,
                    this.cns
                ) as any
            );
        } catch (error) {
            // Sync error occurred
            this.markNeuronInactive(neuron);
            const isAborted = this.options?.abortSignal?.aborted ?? false;
            this.pushFailedTask({
                task: neuronActivationTask,
                error:
                    error instanceof Error
                        ? error
                        : new Error(String(error)),
                aborted: isAborted,
            });
            this.processResponseOrResponses(
                neuron,
                inputSignal as any,
                undefined,
                error
            );
            return () => {};
        }

        const maxDuration = (neuron as any).maxDuration as
            | number
            | undefined;

        if (response instanceof Promise || maxDuration) {
            // Only materialize a Promise on the genuinely async path. The
            // sync path below never touches these, so building them here
            // would allocate a throwaway Promise on every activation.
            const asPromise: Promise<
                | TCNSSignal<CNSCollateral<unknown>>
                | TCNSSignal<CNSCollateral<unknown>>[]
                | undefined
            > =
                response instanceof Promise
                    ? response
                    : Promise.resolve(response as any);

            const timedPromise =
                maxDuration && maxDuration > 0
                    ? new Promise<
                          | TCNSSignal<CNSCollateral<unknown>>
                          | TCNSSignal<CNSCollateral<unknown>>[]
                          | undefined
                      >((resolve, reject) => {
                          const t = setTimeout(() => {
                              const err = new Error(
                                  `Neuron exceeded maxDuration ${maxDuration}ms`
                              );
                              reject(err);
                          }, maxDuration);
                          asPromise.then(
                              v => {
                                  clearTimeout(t);
                                  resolve(v);
                              },
                              e => {
                                  clearTimeout(t);
                                  reject(e);
                              }
                          );
                      })
                    : asPromise;

            return timedPromise.then(
                signal => {
                    return () => {
                        // Mark neuron as inactive when async processing completes
                        this.markNeuronInactive(neuron);
                        return this.processResponseOrResponses(
                            neuron,
                            inputSignal as any,
                            signal as
                                | TCNSSignal<CNSCollateral<unknown>>
                                | TCNSSignal<CNSCollateral<unknown>>[]
                                | undefined
                        );
                    };
                },
                error => {
                    return () => {
                        // Mark neuron as inactive when async processing fails
                        this.markNeuronInactive(neuron);
                        // Track failed task
                        const isAborted =
                            this.options?.abortSignal?.aborted ?? false;
                        this.pushFailedTask({
                            task: neuronActivationTask,
                            error:
                                error instanceof Error
                                    ? error
                                    : new Error(String(error)),
                            aborted: isAborted,
                        });
                        return this.processResponseOrResponses(
                            neuron,
                            inputSignal as any,
                            undefined,
                            error
                        );
                    };
                }
            );
        } else {
            return () => {
                // Mark neuron as inactive when sync processing completes
                this.markNeuronInactive(neuron);
                return this.processResponseOrResponses(
                    neuron,
                    inputSignal as any,
                    response as
                        | TCNSSignal<CNSCollateral<unknown>>
                        | TCNSSignal<CNSCollateral<unknown>>[]
                        | undefined
                );
            };
        }
    }

    protected processResponseOrResponses(
        emitter: TNeuron | undefined,
        inputSignal?: TCNSSignal<CNSCollateral<unknown>>,
        outputSignalOrSignals?:
            | TCNSSignal<CNSCollateral<unknown>>
            | TCNSSignal<CNSCollateral<unknown>>[],
        error?: any
    ): void {
        // Handle array of signals
        if (Array.isArray(outputSignalOrSignals)) {
            // If array is empty, still call processResponse once to trigger onResponse
            if (outputSignalOrSignals.length === 0) {
                this.processResponse(emitter, inputSignal, undefined, error);
                return;
            }

            for (const signal of outputSignalOrSignals) {
                this.processResponse(emitter, inputSignal, signal, error);
            }
            return;
        }

        // Handle single signal
        this.processResponse(emitter, inputSignal, outputSignalOrSignals, error);
    }

    protected processResponse(
        emitter: TNeuron | undefined,
        inputSignal?: TCNSSignal<CNSCollateral<unknown>>,
        outputSignal?: TCNSSignal<CNSCollateral<unknown>>,
        error?: any
    ): void {
        const collateral = outputSignal?.collateral;
        const subscribers = collateral
            ? this.cns.network.getSubscribers(collateral)
            : [];
        const onResponse = this.onResponse;

        // Fast path: with no response listener there is nothing to observe the
        // intermediate state, so we skip building the response object, snapshotting
        // the context (getAll allocates a Map), and tracking pending tasks.
        if (!onResponse) {
            if (collateral && !error) {
                if (emitter) this.cleanupCtxIfNeeded(emitter);
                const n = subscribers.length;
                if (n > 0) {
                    const tasks: TCNSNeuronActivationTask<TNeuron>[] =
                        new Array(n);
                    for (let i = 0; i < n; i++) {
                        tasks[i] = this.createSubscriberQueueItem(
                            subscribers[i],
                            outputSignal
                        );
                    }
                    this.scheduledCount += n;
                    for (let i = 0; i < n; i++) {
                        this.scheduledCount--;
                        this.qEnqueue(tasks[i]);
                    }
                }
            }
            this.tryResolveCompleted();
            return;
        }

        const subscriberActivationTasks: TCNSNeuronActivationTask<TNeuron>[] =
            [];

        if (collateral && !error) {
            if (emitter) this.cleanupCtxIfNeeded(emitter);

            const pending = (this.pendingTasks ??= new Set());
            for (let i = 0; i < subscribers.length; i++) {
                const task = this.createSubscriberQueueItem(
                    subscribers[i],
                    outputSignal
                );
                subscriberActivationTasks.push(task);
                pending.add(task);
            }
        }
        this.scheduledCount += subscriberActivationTasks.length;

        // After we pre-enqueued all subscribers, we can trace the response
        let maybePromise: void | Promise<void>;
        try {
            maybePromise = onResponse(
                new CNSStimulationResponseImpl(
                    this,
                    this.ctxStore,
                    inputSignal,
                    outputSignal,
                    this.qSize + this.scheduledCount,
                    this.options?.maxNeuronHops && emitter
                        ? this.neuronVisitMap?.get(emitter) ?? 0
                        : undefined,
                    error
                ) as TCNSStimulationResponse
            );
        } catch (e) {
            // Remember the error but don't reject immediately - wait for all tasks to complete
            this.onResponseError =
                e instanceof Error ? e : new Error(String(e));
            // Still enqueue subscribers and continue processing
            for (let i = 0; i < subscriberActivationTasks.length; i++) {
                this.scheduledCount--;
                this.pendingTasks?.delete(subscriberActivationTasks[i]);
                this.qEnqueue(subscriberActivationTasks[i]);
            }
            this.tryResolveCompleted();
            return;
        }

        // If onResponse returned a promise, wait for it before enqueuing subscribers
        if (maybePromise && typeof maybePromise.then === 'function') {
            (maybePromise as Promise<void>).then(
                () => {
                    for (let i = 0; i < subscriberActivationTasks.length; i++) {
                        this.scheduledCount--;
                        this.pendingTasks?.delete(subscriberActivationTasks[i]);
                        this.qEnqueue(subscriberActivationTasks[i]);
                    }
                    this.tryResolveCompleted();
                },
                error => {
                    // Remember the error but don't reject immediately - wait for all tasks to complete
                    this.onResponseError =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    // Still enqueue subscribers and continue processing
                    for (let i = 0; i < subscriberActivationTasks.length; i++) {
                        this.scheduledCount--;
                        this.pendingTasks?.delete(subscriberActivationTasks[i]);
                        this.qEnqueue(subscriberActivationTasks[i]);
                    }
                    this.tryResolveCompleted();
                }
            );
            return;
        }

        // Sync path: enqueue subscribers immediately
        for (let i = 0; i < subscriberActivationTasks.length; i++) {
            this.scheduledCount--;
            this.pendingTasks?.delete(subscriberActivationTasks[i]);
            this.qEnqueue(subscriberActivationTasks[i]);
        }
        this.tryResolveCompleted();
    }

    public responseToSignal(
        signalOrSignals:
            | TCNSSignal<CNSCollateral<unknown>>
            | TCNSSignal<CNSCollateral<unknown>>[]
    ): void {
        // Handle array of signals
        if (Array.isArray(signalOrSignals)) {
            // For initial stimulation: signals are outputs (to find subscribers)
            // In onResponse, inputSignal will be undefined for initial stimulation
            this.processResponseOrResponses(undefined, undefined, signalOrSignals);
            return;
        }

        // For initial stimulation: signal is the output (to find subscribers)
        // In onResponse, inputSignal will be undefined for initial stimulation
        this.processResponse(undefined, undefined, signalOrSignals);
        this.tryResolveCompleted();
    }
}
