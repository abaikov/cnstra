import { CNSStimulationContextStore } from './CNSStimulationContextStore';
import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';
import { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { CNSNeuronActivationPump } from './CNSNeuronActivationPump';
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

export class CNSStimulation<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {
    private readonly ctx: ICNSStimulationContextStore;
    private readonly queue: CNSNeuronActivationPump<TNeuron>;

    private readonly nueronVisitMap?: Map<TNeuron, number>;
    private readonly instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>;
    private scheduledCount = 0;
    private readonly pendingTasks = new Set<
        TCNSNeuronActivationTask<TNeuron>
    >();
    private readonly failedTasks: Array<
        TCNSNeuronActivationTaskFailure<TNeuron>
    > = [];
    private completed = new Promise<void>((resolve, reject) => {
        this.resolveCompleted = resolve;
        this.rejectCompleted = reject;
    });
    private resolveCompleted!: () => void;
    private rejectCompleted!: (e: any) => void;
    private isCompleted = false;
    private onResponseError: Error | undefined;

    /**
     * Track active SCCs: SCC index -> count of active neurons in that SCC
     */
    private readonly activeSccCounts = new Map<number, number>();

    constructor(
        public readonly cns: CNS<TNeuron, TDendrite>,
        instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>,
        public readonly options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ) {
        this.ctx = options?.ctx ?? new CNSStimulationContextStore();
        this.queue = new CNSNeuronActivationPump<TNeuron>(
            neuronActivationTask =>
                this.executeActivationTask(neuronActivationTask),
            options?.concurrency,
            options?.abortSignal
        );

        this.instanceNeuronQueue = instanceNeuronQueue;

        if (this.options?.maxNeuronHops) {
            this.nueronVisitMap = new Map();
        }
    }

    private tryResolveCompleted(): void {
        if (this.isCompleted) return;
        const noActive = this.queue.getActiveOperationsCount() === 0;
        const noPending = this.queue.length + this.scheduledCount === 0;
        const aborted = !!this.options?.abortSignal?.aborted;

        if ((noPending && noActive) || (aborted && noActive && !noPending)) {
            // When completing due to abort, mark all remaining queued tasks as aborted
            if (aborted) {
                const queuedTasks = this.queue.getQueuedTasks();

                for (const task of [...queuedTasks]) {
                    const alreadyTracked = this.failedTasks.some(
                        ft => ft.task === task
                    );
                    if (!alreadyTracked) {
                        this.failedTasks.push({
                            task,
                            error: new Error(
                                'Task aborted - not started due to abort signal'
                            ),
                            aborted: true,
                        });
                    }
                }

                this.isCompleted = true;
                this.rejectCompleted(new Error('Stimulation aborted'));
                return;
            }

            this.isCompleted = true;
            // If there are failed tasks or onResponse error, reject the promise
            // Otherwise resolve it
            if (this.failedTasks.length > 0 || this.onResponseError) {
                const error =
                    this.onResponseError ||
                    new Error(
                        `Stimulation completed with ${this.failedTasks.length} failed task(s)`
                    );
                this.rejectCompleted(error);
            } else {
                this.resolveCompleted();
            }
        }
    }

    public waitUntilComplete(): Promise<void> {
        return this.completed;
    }

    /**
     * Returns all current activation tasks: queued, active, and pending (scheduled but not yet enqueued)
     */
    public getAllActivationTasks(): TCNSNeuronActivationTask<TNeuron>[] {
        const queuedTasks = this.queue.getQueuedTasks();
        const activeTasks = this.queue.getActiveTasks();
        const pendingTasks = Array.from(this.pendingTasks);
        return [...queuedTasks, ...activeTasks, ...pendingTasks];
    }

    /**
     * Returns all tasks that failed or were aborted
     */
    public getFailedTasks(): Array<TCNSNeuronActivationTaskFailure<TNeuron>> {
        return [...this.failedTasks];
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
            this.queue.enqueue(task);
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
        const sccIndex = this.cns.network.getSccIndexByNeuron(neuron);
        if (sccIndex === undefined) return;

        const currentCount = this.activeSccCounts.get(sccIndex) || 0;
        this.activeSccCounts.set(sccIndex, currentCount + 1);
    }

    /**
     * Decrement the active count for the SCC containing this neuron
     */
    private decrementSccCount(neuron: TNeuron): void {
        const sccIndex = this.cns.network.getSccIndexByNeuron(neuron);
        if (sccIndex === undefined) return;

        const currentCount = this.activeSccCounts.get(sccIndex) || 0;
        const nextCount = Math.max(0, currentCount - 1);
        this.activeSccCounts.set(sccIndex, nextCount);

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
        if (!this.autoCleanupContextsEnabled) return false;
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
            this.ctx.delete(neuron);
        }
    }

    protected createSubscriberQueueItem(
        subscriber: TCNSSubscriber<TNeuron, TDendrite>,
        inputSignal?: TCNSSignal<CNSCollateral<unknown>>
    ) {
        if (this.options?.maxNeuronHops) {
            if (
                (this.nueronVisitMap?.get(subscriber.neuron) ?? 0) >=
                this.options?.maxNeuronHops
            ) {
                throw new Error(
                    `Max neuron hops reached when trying to enqueue subscriber`
                );
            } else {
                this.nueronVisitMap?.set(
                    subscriber.neuron,
                    (this.nueronVisitMap?.get(subscriber.neuron) ?? 0) + 1
                );
            }
        }

        const neuronActivationTask: TCNSNeuronActivationTask<TNeuron> = {
            neuron: subscriber.neuron,
            dendriteCollateral: subscriber.dendrite.collateral as CNSCollateral<unknown>,
            input: inputSignal,
        };
        return neuronActivationTask;
    }

    private executeActivationTask(
        neuronActivationTask: TCNSNeuronActivationTask<TNeuron>
    ) {
        const subscribers = this.cns.network.getSubscribers(
            neuronActivationTask.dendriteCollateral
        );
        const subscriber = subscribers.find(
            s => s.neuron === neuronActivationTask.neuron
        );
        if (!subscriber) {
            // Task failed: subscriber not found
            this.failedTasks.push({
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

        const starter = () => {
            // Mark neuron as active only when we actually start processing (after gate allows it)
            this.markNeuronActive(neuron);

            let response: TNCNeuronResponseReturn<TCNSAxon>;
            try {
                response = dendrite.response(
                    inputSignal?.payload,
                    neuron.axon,
                    {
                        get: () => this.ctx.get(neuron),
                        set: (value: any) => this.ctx.set(neuron, value),
                        delete: () => this.ctx.delete(neuron),
                        abortSignal: this.options?.abortSignal,
                        cns: this.cns as ICNS<TNeuron, TDendrite>,
                        stimulation: this,
                    } as any
                );
            } catch (error) {
                // Sync error occurred
                this.markNeuronInactive(neuron);
                const isAborted = this.options?.abortSignal?.aborted ?? false;
                this.failedTasks.push({
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

            if (response instanceof Promise || maxDuration) {
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
                            this.failedTasks.push({
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
        };

        // Use CNS-provided per-instance neuron queue for global concurrency gating
        return this.instanceNeuronQueue.run(neuron, starter);
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
        const subscriberActivationTasks: TCNSNeuronActivationTask<TNeuron>[] =
            [];

        if (collateral && !error) {
            if (emitter) this.cleanupCtxIfNeeded(emitter);

            for (let i = 0; i < subscribers.length; i++) {
                const task = this.createSubscriberQueueItem(
                    subscribers[i],
                    outputSignal
                );
                subscriberActivationTasks.push(task);
                this.pendingTasks.add(task);
            }
        }
        this.scheduledCount += subscriberActivationTasks.length;

        // After we pre-enqueued all subscribers, we can trace the response
        let maybePromise: void | Promise<void>;
        try {
            maybePromise = this.options?.onResponse?.({
                inputSignal: inputSignal,
                outputSignal: outputSignal,
                contextValue: this.ctx.getAll(),
                queueLength: this.queue.length + this.scheduledCount,
                stimulation: this,

                hops:
                    this.options?.maxNeuronHops && emitter
                        ? this.nueronVisitMap?.get(emitter) ?? 0
                        : undefined,
                error,
            });
        } catch (e) {
            // Remember the error but don't reject immediately - wait for all tasks to complete
            this.onResponseError =
                e instanceof Error ? e : new Error(String(e));
            // Still enqueue subscribers and continue processing
            for (let i = 0; i < subscriberActivationTasks.length; i++) {
                this.scheduledCount--;
                this.pendingTasks.delete(subscriberActivationTasks[i]);
                this.queue.enqueue(subscriberActivationTasks[i]);
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
                        this.pendingTasks.delete(subscriberActivationTasks[i]);
                        this.queue.enqueue(subscriberActivationTasks[i]);
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
                        this.pendingTasks.delete(subscriberActivationTasks[i]);
                        this.queue.enqueue(subscriberActivationTasks[i]);
                    }
                    this.tryResolveCompleted();
                }
            );
            return;
        }

        // Sync path: enqueue subscribers immediately
        for (let i = 0; i < subscriberActivationTasks.length; i++) {
            this.scheduledCount--;
            this.pendingTasks.delete(subscriberActivationTasks[i]);
            this.queue.enqueue(subscriberActivationTasks[i]);
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
