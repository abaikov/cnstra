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

export class CNSStimulation<
    TCollateralName extends string,
    TNeuronName extends string,
    TNeuron extends TCNSNeuron<
        any,
        TNeuronName,
        TCollateralName,
        any,
        any,
        any,
        any
    >,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>,
    TInputPayload,
    TOutputPayload
> {
    private readonly ctx: ICNSStimulationContextStore;
    private readonly queue: CNSNeuronActivationPump<
        TCollateralName,
        TNeuronName
    >;
    private readonly nueronVisitMap?: Map<TNeuronName, number>;
    private readonly instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>;
    private scheduledCount = 0;
    private readonly pendingTasks = new Set<
        TCNSNeuronActivationTask<TCollateralName, TNeuronName>
    >();
    private readonly failedTasks: Array<
        TCNSNeuronActivationTaskFailure<TCollateralName, TNeuronName>
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

    public readonly id: string;

    constructor(
        private readonly cns: CNS<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite
        >,
        instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>,
        public readonly options?: TCNSStimulationOptions<
            TCollateralName,
            TInputPayload,
            TOutputPayload,
            TNeuronName
        >
    ) {
        this.ctx =
            options?.ctx ??
            new CNSStimulationContextStore(
                new Map(Object.entries(options?.contextValues ?? {}))
            );
        this.id = options?.stimulationId || Math.random().toString(36).slice(2);
        this.queue = new CNSNeuronActivationPump(
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
                        ft =>
                            ft.task.neuronId === task.neuronId &&
                            ft.task.dendriteCollateralName ===
                                task.dendriteCollateralName &&
                            ft.task.stimulationId === task.stimulationId
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
    public getAllActivationTasks(): TCNSNeuronActivationTask<
        TCollateralName,
        TNeuronName
    >[] {
        const queuedTasks = this.queue.getQueuedTasks();
        const activeTasks = this.queue.getActiveTasks();
        const pendingTasks = Array.from(this.pendingTasks);
        return [...queuedTasks, ...activeTasks, ...pendingTasks];
    }

    /**
     * Returns all tasks that failed or were aborted
     */
    public getFailedTasks(): Array<
        TCNSNeuronActivationTaskFailure<TCollateralName, TNeuronName>
    > {
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
        tasks: TCNSNeuronActivationTask<TCollateralName, TNeuronName>[]
    ): void {
        for (const task of tasks) {
            // Ensure task has correct stimulationId
            const taskWithId: TCNSNeuronActivationTask<
                TCollateralName,
                TNeuronName
            > = {
                ...task,
                stimulationId: this.id,
            };
            this.queue.enqueue(taskWithId);
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
    protected markNeuronActive(neuronId: TNeuronName): void {
        if (!this.autoCleanupContextsEnabled) return;

        this.incrementSccCount(neuronId);
    }

    /**
     * Mark a neuron as inactive (finished processing)
     */
    protected markNeuronInactive(neuronId: TNeuronName): void {
        if (!this.autoCleanupContextsEnabled) return;

        this.decrementSccCount(neuronId);
    }

    /**
     * Increment the active count for the SCC containing this neuron
     */
    private incrementSccCount(neuronId: TNeuronName): void {
        const sccIndex = this.cns.network.getSccIndexByNeuronName(neuronId);
        if (sccIndex === undefined) return;

        const currentCount = this.activeSccCounts.get(sccIndex) || 0;
        this.activeSccCounts.set(sccIndex, currentCount + 1);
    }

    /**
     * Decrement the active count for the SCC containing this neuron
     */
    private decrementSccCount(neuronId: TNeuronName): void {
        const sccIndex = this.cns.network.getSccIndexByNeuronName(neuronId);
        if (sccIndex === undefined) return;

        const currentCount = this.activeSccCounts.get(sccIndex) || 0;
        const nextCount = Math.max(0, currentCount - 1);
        this.activeSccCounts.set(sccIndex, nextCount);

        // Log warning if we're trying to decrement below 0
        if (currentCount === 0) {
            console.warn(
                `[CNSStimulation] Attempting to decrement SCC count below 0 for neuron ${neuronId}`
            );
        }
    }

    /**
     * Check if a neuron can be guaranteed not to be visited again
     */
    protected canNeuronBeGuaranteedDone(neuronId: TNeuronName): boolean {
        if (!this.autoCleanupContextsEnabled) return false;
        return this.cns.network.canNeuronBeGuaranteedDone(
            neuronId,
            this.activeSccCounts
        );
    }

    protected cleanupCtxIfNeeded(neuron: TNeuron): void {
        if (
            this.autoCleanupContextsEnabled &&
            this.canNeuronBeGuaranteedDone(neuron.name)
        ) {
            this.ctx.delete(neuron.name);
        }
    }

    protected createSubscriberQueueItem(
        subscriber: TCNSSubscriber<TNeuron, TDendrite>,
        inputSignal?: TCNSSignal<TCollateralName, any>
    ) {
        if (this.options?.maxNeuronHops) {
            if (
                this.nueronVisitMap?.get(subscriber.neuron.name) ??
                0 >= this.options?.maxNeuronHops
            ) {
                throw new Error(
                    `Max neuron hops reached for neuron "${subscriber.neuron.name}" ` +
                        `when trying to enqueue subscriber "${subscriber.dendrite.collateral.name}" ` +
                        `in stimulation "${this.id}"`
                );
            } else {
                this.nueronVisitMap?.set(
                    subscriber.neuron.name,
                    (this.nueronVisitMap?.get(subscriber.neuron.name) ?? 0) + 1
                );
            }
        }

        const neuronActivationTask: TCNSNeuronActivationTask<
            TCollateralName,
            TNeuronName
        > = {
            stimulationId: this.id,
            neuronId: subscriber.neuron.name,
            dendriteCollateralName: subscriber.dendrite.collateral.name,
            input: inputSignal,
        };
        return neuronActivationTask;
    }

    private executeActivationTask(
        neuronActivationTask: TCNSNeuronActivationTask<
            TCollateralName,
            TNeuronName
        >
    ) {
        const subscribers = this.cns.network.getSubscribers(
            neuronActivationTask.dendriteCollateralName
        );
        const subscriber = subscribers.find(
            s => s.neuron.name === neuronActivationTask.neuronId
        );
        if (!subscriber) {
            // Task failed: subscriber not found
            this.failedTasks.push({
                task: neuronActivationTask,
                error: new Error(
                    `Subscriber not found for neuron "${neuronActivationTask.neuronId}" and collateral "${neuronActivationTask.dendriteCollateralName}"`
                ),
                aborted: false,
            });
            return () => {};
        }

        const neuron = subscriber.neuron;
        const dendrite = subscriber.dendrite as TDendrite;

        const inputSignal = neuronActivationTask.input
            ? ({
                  collateralName: neuronActivationTask.input.collateralName,
                  payload: neuronActivationTask.input.payload,
              } as TCNSSignal<TCollateralName, any>)
            : undefined;

        const starter = () => {
            // Mark neuron as active only when we actually start processing (after gate allows it)
            this.markNeuronActive(neuron.name);

            let response;
            try {
                response = dendrite.response(
                    inputSignal?.payload,
                    neuron.axon,
                    {
                        get: () => this.ctx.get(neuron.name),
                        set: (value: any) => this.ctx.set(neuron.name, value),
                        delete: () => this.ctx.delete(neuron.name),
                        abortSignal: this.options?.abortSignal,
                        cns: this.cns as ICNS<
                            TCollateralName,
                            TNeuronName,
                            TNeuron,
                            TDendrite
                        >,
                        stimulationId: this.id,
                    }
                );
            } catch (error) {
                // Sync error occurred
                this.markNeuronInactive(neuron.name);
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
                    inputSignal as TCNSSignal<TCollateralName, any>,
                    undefined,
                    error
                );
                return () => {};
            }

            const maxDuration = (neuron as any).maxDuration as
                | number
                | undefined;

            const asPromise: Promise<
                | TCNSSignal<TCollateralName, any>
                | TCNSSignal<TCollateralName, any>[]
                | undefined
            > =
                response instanceof Promise
                    ? response
                    : Promise.resolve(response as any);

            const timedPromise =
                maxDuration && maxDuration > 0
                    ? new Promise<
                          | TCNSSignal<TCollateralName, any>
                          | TCNSSignal<TCollateralName, any>[]
                          | undefined
                      >((resolve, reject) => {
                          const t = setTimeout(() => {
                              const err = new Error(
                                  `Neuron "${String(
                                      neuron.name
                                  )}" exceeded maxDuration ${maxDuration}ms`
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
                            this.markNeuronInactive(neuron.name);
                            return this.processResponseOrResponses(
                                inputSignal as TCNSSignal<TCollateralName, any>,
                                signal as
                                    | TCNSSignal<TCollateralName, any>
                                    | TCNSSignal<TCollateralName, any>[]
                                    | undefined
                            );
                        };
                    },
                    error => {
                        return () => {
                            // Mark neuron as inactive when async processing fails
                            this.markNeuronInactive(neuron.name);
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
                                inputSignal as TCNSSignal<TCollateralName, any>,
                                undefined,
                                error
                            );
                        };
                    }
                );
            } else {
                return () => {
                    // Mark neuron as inactive when sync processing completes
                    this.markNeuronInactive(neuron.name);
                    return this.processResponseOrResponses(
                        inputSignal as TCNSSignal<TCollateralName, any>,
                        response as
                            | TCNSSignal<TCollateralName, any>
                            | TCNSSignal<TCollateralName, any>[]
                            | undefined
                    );
                };
            }
        };

        // Use CNS-provided per-instance neuron queue for global concurrency gating
        return this.instanceNeuronQueue.run(neuron, starter);
    }

    protected processResponseOrResponses(
        inputSignal?: TCNSSignal<TCollateralName, TInputPayload>,
        outputSignalOrSignals?:
            | TCNSSignal<TCollateralName, TOutputPayload>
            | TCNSSignal<TCollateralName, TOutputPayload>[],
        error?: any
    ): void {
        // Handle array of signals
        if (Array.isArray(outputSignalOrSignals)) {
            // If array is empty, still call processResponse once to trigger onResponse
            if (outputSignalOrSignals.length === 0) {
                this.processResponse(inputSignal, undefined, error);
                return;
            }

            for (const signal of outputSignalOrSignals) {
                this.processResponse(inputSignal, signal, error);
            }
            return;
        }

        // Handle single signal
        this.processResponse(inputSignal, outputSignalOrSignals, error);
    }

    protected processResponse(
        inputSignal?: TCNSSignal<TCollateralName, TInputPayload>,
        outputSignal?: TCNSSignal<TCollateralName, TOutputPayload>,
        error?: any
    ): void {
        const collateralName = outputSignal?.collateralName as
            | TCollateralName
            | undefined;
        const ownerNeuron = collateralName
            ? this.cns.network.getParentNeuronByCollateralName(collateralName)
            : undefined;
        const subscribers = collateralName
            ? this.cns.network.getSubscribers(collateralName)
            : [];
        const subscriberActivationTasks: TCNSNeuronActivationTask<
            TCollateralName,
            TNeuronName
        >[] = [];

        if (collateralName && !error) {
            if (ownerNeuron) {
                this.cleanupCtxIfNeeded(ownerNeuron);
            }

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
                stimulationId: this.id,

                hops:
                    this.options?.maxNeuronHops && ownerNeuron
                        ? this.nueronVisitMap?.get(ownerNeuron.name) ?? 0
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
            | TCNSSignal<TCollateralName, TOutputPayload>
            | TCNSSignal<TCollateralName, TOutputPayload>[]
    ): void {
        // Handle array of signals
        if (Array.isArray(signalOrSignals)) {
            for (const signal of signalOrSignals) {
                const ownerNeuron =
                    this.cns.network.getParentNeuronByCollateralName(
                        signal.collateralName
                    );
                if (ownerNeuron) {
                    this.markNeuronActive(ownerNeuron.name);
                }
            }
            // For initial stimulation: signals are outputs (to find subscribers)
            // In onResponse, inputSignal will be undefined for initial stimulation
            this.processResponseOrResponses(undefined, signalOrSignals);
            return;
        }

        // Handle single signal
        const ownerNeuron = this.cns.network.getParentNeuronByCollateralName(
            signalOrSignals.collateralName
        );
        if (ownerNeuron) {
            this.markNeuronActive(ownerNeuron.name);
        }

        // For initial stimulation: signal is the output (to find subscribers)
        // In onResponse, inputSignal will be undefined for initial stimulation
        this.processResponse(undefined, signalOrSignals);
        this.tryResolveCompleted();
    }
}
