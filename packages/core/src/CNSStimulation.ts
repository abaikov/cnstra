import { CNSStimulationContextStore } from './CNSStimulationContextStore';
import { ICNS } from './interfaces/ICNS';
import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';
import { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { CNSFunctionalQueue } from './CNSFunctionalQueue';
import { CNSInstanceNeuronQueue } from './CNSInstanceNeuronQueue';
import { TCNSSignal } from './types/TCNSSignal';
import { TCNSSerializedQueueItem } from './types/TCNSSerializedSignal';

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
    private readonly queue: CNSFunctionalQueue<
        TCollateralName,
        TNeuronName,
        TNeuron,
        TDendrite
    >;
    private readonly nueronVisitMap?: Map<TNeuronName, number>;
    private readonly instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>;
    private scheduledCount = 0;
    private completed = new Promise<void>((resolve, reject) => {
        this.resolveCompleted = resolve;
        this.rejectCompleted = reject;
    });
    private resolveCompleted!: () => void;
    private rejectCompleted!: (e: any) => void;
    private isCompleted = false;

    /**
     * Track active SCCs: SCC index -> count of active neurons in that SCC
     */
    private readonly activeSccCounts = new Map<number, number>();

    public readonly id: string;

    constructor(
        private readonly cns: ICNS<TNeuron, TDendrite>,
        instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>,
        public readonly options?: TCNSStimulationOptions<
            TCollateralName,
            TInputPayload,
            TOutputPayload
        >
    ) {
        this.ctx =
            options?.ctx ??
            options?.createContextStore?.() ??
            new CNSStimulationContextStore();
        this.id = options?.stimulationId || Math.random().toString(36).slice(2);
        this.queue = new CNSFunctionalQueue(
            item => this.processQueueItem(item),
            options?.concurrency,
            options?.abortSignal
        );

        this.instanceNeuronQueue = instanceNeuronQueue;

        if (this.options?.maxNeuronHops) {
            this.nueronVisitMap = new Map();
        }

        // If aborted, re-check completion condition (to allow graceful shutdown)
        if (this.options?.abortSignal) {
            this.options.abortSignal.addEventListener('abort', () => {
                this.tryResolveCompleted();
            });
        }
    }
    private tryResolveCompleted(): void {
        if (this.isCompleted) return;
        const noActive = this.queue.getActiveOperationsCount() === 0;
        const noPending = this.queue.length + this.scheduledCount === 0;
        const aborted = !!this.options?.abortSignal?.aborted;

        if ((noPending && noActive) || (aborted && noActive)) {
            this.isCompleted = true;
            this.resolveCompleted();
        }
    }

    public waitUntilComplete(): Promise<void> {
        return this.completed;
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
        const sccIndex = this.cns.getSccIndexByNeuronName(neuronId);
        if (sccIndex === undefined) return;

        const currentCount = this.activeSccCounts.get(sccIndex) || 0;
        this.activeSccCounts.set(sccIndex, currentCount + 1);
    }

    /**
     * Decrement the active count for the SCC containing this neuron
     */
    private decrementSccCount(neuronId: TNeuronName): void {
        const sccIndex = this.cns.getSccIndexByNeuronName(neuronId);
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
        return this.cns.canNeuronBeGuaranteedDone(
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

        const serialized: TCNSSerializedQueueItem<
            TCollateralName,
            TNeuronName
        > = {
            neuronId: subscriber.neuron.name,
            dendriteCollateralName: subscriber.dendrite.collateral
                .name as TCollateralName,
            input: inputSignal
                ? {
                      collateralName:
                          inputSignal.collateralName as TCollateralName,
                      payload: inputSignal.payload,
                  }
                : undefined,
        };

        return serialized;
    }

    private processQueueItem(
        item: TCNSSerializedQueueItem<TCollateralName, TNeuronName>
    ) {
        const subscribers = this.cns.getSubscribers(
            item.dendriteCollateralName as any
        );
        const subscriber = subscribers.find(
            s => (s.neuron.name as any) === (item.neuronId as any)
        );
        if (!subscriber) return () => {};

        const neuron = subscriber.neuron;
        const dendrite = subscriber.dendrite as TDendrite;

        const inputSignal = item.input
            ? ({
                  collateralName: item.input.collateralName as any,
                  payload: item.input.payload,
              } as TCNSSignal<TCollateralName, any>)
            : undefined;

        const starter = () => {
            // Mark neuron as active only when we actually start processing (after gate allows it)
            this.markNeuronActive(neuron.name);

            const response = dendrite.response(
                inputSignal?.payload,
                neuron.axon,
                {
                    get: () => this.ctx.get(neuron.name),
                    set: (value: any) => this.ctx.set(neuron.name, value),
                    delete: () => this.ctx.delete(neuron.name),
                    abortSignal: this.options?.abortSignal,
                    cns: this.cns,
                    stimulationId: this.id,
                }
            );

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
            ? this.cns.getParentNeuronByCollateralName(collateralName)
            : undefined;
        const subscribers = collateralName
            ? this.cns.getSubscribers(collateralName)
            : [];
        const subscriberQueueItems: TCNSSerializedQueueItem<
            TCollateralName,
            TNeuronName
        >[] = [];

        if (collateralName && !error) {
            if (ownerNeuron) {
                this.cleanupCtxIfNeeded(ownerNeuron);
            }

            for (let i = 0; i < subscribers.length; i++) {
                subscriberQueueItems.push(
                    this.createSubscriberQueueItem(subscribers[i], outputSignal)
                );
            }
        }
        this.scheduledCount += subscriberQueueItems.length;

        // After we pre-enqueued all subscribers, we can trace the response
        let maybePromise: any;
        try {
            maybePromise = this.options?.onResponse?.({
                inputSignal: inputSignal,
                outputSignal: outputSignal,
                ctx: this.ctx,
                queueLength: this.queue.length + this.scheduledCount,
                stimulationId: this.id,

                hops:
                    this.options?.maxNeuronHops && ownerNeuron
                        ? this.nueronVisitMap?.get(ownerNeuron.name) ?? 0
                        : undefined,
                error,
            } as any);
        } catch (e) {
            this.rejectCompleted(e);
            return;
        }

        // If onResponse returned a promise, wait for it before enqueuing subscribers
        if (maybePromise && typeof (maybePromise as any).then === 'function') {
            (maybePromise as Promise<void>).then(
                () => {
                    for (let i = 0; i < subscriberQueueItems.length; i++) {
                        this.scheduledCount--;
                        this.queue.enqueue(subscriberQueueItems[i]);
                    }
                    this.tryResolveCompleted();
                },
                error => {
                    this.rejectCompleted(error);
                }
            );
            return;
        }

        // Sync path: enqueue subscribers immediately
        for (let i = 0; i < subscriberQueueItems.length; i++) {
            this.scheduledCount--;
            this.queue.enqueue(subscriberQueueItems[i]);
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
                const ownerNeuron = this.cns.getParentNeuronByCollateralName(
                    signal.collateralName as any
                );
                if (ownerNeuron) {
                    this.markNeuronActive(ownerNeuron.name);
                }
            }
            this.processResponseOrResponses(undefined, signalOrSignals);
            return;
        }

        // Handle single signal
        const ownerNeuron = this.cns.getParentNeuronByCollateralName(
            signalOrSignals.collateralName as any
        );
        if (ownerNeuron) {
            this.markNeuronActive(ownerNeuron.name);
        }

        this.processResponse(undefined, signalOrSignals);
        this.tryResolveCompleted();
    }
}
