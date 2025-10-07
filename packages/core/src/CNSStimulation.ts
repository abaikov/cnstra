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
import { TCNSStimulationQueueItem } from './types/TCNSStimulationQueueItem';

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

        return {
            neuronId: subscriber.neuron.name,
            subscriber,
            inputSignal,
        };
    }

    private processQueueItem(
        item: TCNSStimulationQueueItem<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite
        >
    ) {
        const { subscriber, inputSignal } = item;
        const { neuron, dendrite } = subscriber;

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
                }
            );

            if (response instanceof Promise) {
                return response.then(
                    signal => {
                        return () => {
                            // Mark neuron as inactive when async processing completes
                            this.markNeuronInactive(neuron.name);
                            return this.processResponse(
                                inputSignal as TCNSSignal<TCollateralName, any>,
                                signal as
                                    | TCNSSignal<TCollateralName, any>
                                    | undefined
                            );
                        };
                    },
                    error => {
                        return () => {
                            // Mark neuron as inactive when async processing fails
                            this.markNeuronInactive(neuron.name);
                            return this.processResponse(
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
                    return this.processResponse(
                        inputSignal as TCNSSignal<TCollateralName, any>,
                        response as TCNSSignal<TCollateralName, any> | undefined
                    );
                };
            }
        };

        // Use CNS-provided per-instance neuron queue for global concurrency gating
        return this.instanceNeuronQueue.run(neuron, starter);
    }

    protected processResponse(
        inputSignal?: TCNSSignal<TCollateralName, TInputPayload>,
        outputSignal?: TCNSSignal<TCollateralName, TOutputPayload>,
        error?: any
    ): void {
        const collateral = outputSignal?.collateral;
        const ownerNeuron = collateral
            ? this.cns.getParentNeuronByCollateralName(collateral.name)
            : undefined;
        const subscribers = collateral
            ? this.cns.getSubscribers(collateral.name)
            : [];
        const subscriberQueueItems: TCNSStimulationQueueItem<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite
        >[] = [];

        if (collateral && !error) {
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
        this.options?.onResponse?.({
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

        // After we traced the response, we can enqueue the pre-enqueued subscribers
        // So if we have a synchronous response - the traces would go
        // from start to end and will show the correct queueLength === 0
        // in the end
        for (let i = 0; i < subscriberQueueItems.length; i++) {
            this.scheduledCount--;
            this.queue.enqueue(subscriberQueueItems[i]);
        }
    }

    public responseToSignal(
        signal: TCNSSignal<TCollateralName, TOutputPayload>
    ): void {
        // Mark the owner neuron of the initial signal as active
        const ownerNeuron = this.cns.getParentNeuronByCollateralName(
            signal.collateral.name
        );
        if (ownerNeuron) {
            this.markNeuronActive(ownerNeuron.name);
        }

        this.processResponse(undefined, signal);
    }
}
