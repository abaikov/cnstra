import { CNSStimulationContextStore } from './CNSStimulationContextStore';
import { ICNS } from './interfaces/ICNS';
import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';
import { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { CNSFunctionalQueue } from './CNSFunctionalQueue';
import { TCNSSignal } from './types/TCNSSignal';
import { TCNSStimulationQueueItem } from './types/TCNSStimulationQueueItem';

export class CNSStimulation<
    TCollateralId extends string,
    TNeuronId extends string,
    TNeuron extends TCNSNeuron<
        any,
        TNeuronId,
        TCollateralId,
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
        TCollateralId,
        TNeuronId,
        TNeuron,
        TDendrite
    >;
    private readonly nueronVisitMap?: Map<TNeuronId, number>;
    private scheduledCount = 0;

    /**
     * Track active SCCs: SCC index -> count of active neurons in that SCC
     */
    private readonly activeSccCounts = new Map<number, number>();

    public readonly id: string;

    constructor(
        private readonly cns: ICNS<TNeuron, TDendrite>,
        public readonly options?: TCNSStimulationOptions<
            TCollateralId,
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
    protected markNeuronActive(neuronId: TNeuronId): void {
        if (!this.autoCleanupContextsEnabled) return;

        this.incrementSccCount(neuronId);
    }

    /**
     * Mark a neuron as inactive (finished processing)
     */
    protected markNeuronInactive(neuronId: TNeuronId): void {
        if (!this.autoCleanupContextsEnabled) return;

        this.decrementSccCount(neuronId);
    }

    /**
     * Increment the active count for the SCC containing this neuron
     */
    private incrementSccCount(neuronId: TNeuronId): void {
        const sccIndex = this.cns.getSccIndexByNeuronId(neuronId);
        if (sccIndex === undefined) return;

        const currentCount = this.activeSccCounts.get(sccIndex) || 0;
        this.activeSccCounts.set(sccIndex, currentCount + 1);
    }

    /**
     * Decrement the active count for the SCC containing this neuron
     */
    private decrementSccCount(neuronId: TNeuronId): void {
        const sccIndex = this.cns.getSccIndexByNeuronId(neuronId);
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
    protected canNeuronBeGuaranteedDone(neuronId: TNeuronId): boolean {
        if (!this.autoCleanupContextsEnabled) return false;
        return this.cns.canNeuronBeGuaranteedDone(
            neuronId,
            this.activeSccCounts
        );
    }

    protected cleanupCtxIfNeeded(neuron: TNeuron): void {
        if (
            this.autoCleanupContextsEnabled &&
            this.canNeuronBeGuaranteedDone(neuron.id)
        ) {
            this.ctx.delete(neuron.id);
        }
    }

    protected createSubscriberQueueItem(
        subscriber: TCNSSubscriber<TNeuron, TDendrite>,
        inputSignal?: TCNSSignal<TCollateralId, any>
    ) {
        if (this.options?.maxNeuronHops) {
            if (
                this.nueronVisitMap?.get(subscriber.neuron.id) ??
                0 >= this.options?.maxNeuronHops
            ) {
                throw new Error(
                    `Max neuron hops reached for neuron "${subscriber.neuron.id}" ` +
                        `when trying to enqueue subscriber "${subscriber.dendrite.collateral.id}" ` +
                        `in stimulation "${this.id}"`
                );
            } else {
                this.nueronVisitMap?.set(
                    subscriber.neuron.id,
                    (this.nueronVisitMap?.get(subscriber.neuron.id) ?? 0) + 1
                );
            }
        }

        return {
            neuronId: subscriber.neuron.id,
            subscriber,
            inputSignal,
        };
    }

    private processQueueItem(
        item: TCNSStimulationQueueItem<
            TCollateralId,
            TNeuronId,
            TNeuron,
            TDendrite
        >
    ) {
        const { subscriber, inputSignal } = item;
        const { neuron, dendrite } = subscriber;

        // Mark neuron as active when processing starts
        this.markNeuronActive(neuron.id);

        const response = dendrite.response(
            inputSignal?.payload,
            neuron.axon,
            {
                get: () => this.ctx.get(neuron.id),
                set: (value: any) => this.ctx.set(neuron.id, value),
            },
            this.options?.abortSignal
        );

        if (response instanceof Promise) {
            return response.then(
                signal => {
                    return () => {
                        // Mark neuron as inactive when async processing completes
                        this.markNeuronInactive(neuron.id);
                        return this.processResponse(
                            inputSignal as TCNSSignal<TCollateralId, any>,
                            signal as TCNSSignal<TCollateralId, any> | undefined
                        );
                    };
                },
                error => {
                    return () => {
                        // Mark neuron as inactive when async processing fails
                        this.markNeuronInactive(neuron.id);
                        return this.processResponse(
                            inputSignal as TCNSSignal<TCollateralId, any>,
                            undefined,
                            error
                        );
                    };
                }
            );
        } else {
            return () => {
                // Mark neuron as inactive when sync processing completes
                this.markNeuronInactive(neuron.id);
                return this.processResponse(
                    inputSignal as TCNSSignal<TCollateralId, any>,
                    response as TCNSSignal<TCollateralId, any> | undefined
                );
            };
        }
    }

    protected processResponse(
        inputSignal?: TCNSSignal<TCollateralId, TInputPayload>,
        outputSignal?: TCNSSignal<TCollateralId, TOutputPayload>,
        error?: any
    ): void {
        const collateral = outputSignal?.collateral;
        const ownerNeuron = collateral
            ? this.cns.getParentNeuronByCollateralId(collateral.id)
            : undefined;
        const subscribers = collateral
            ? this.cns.getSubscribers(collateral.id)
            : [];
        const subscriberQueueItems: TCNSStimulationQueueItem<
            TCollateralId,
            TNeuronId,
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

            hops:
                this.options?.maxNeuronHops && ownerNeuron
                    ? this.nueronVisitMap?.get(ownerNeuron.id) ?? 0
                    : undefined,
            error,
        });

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
        signal: TCNSSignal<TCollateralId, TOutputPayload>
    ): void {
        // Mark the owner neuron of the initial signal as active
        const ownerNeuron = this.cns.getParentNeuronByCollateralId(
            signal.collateral.id
        );
        if (ownerNeuron) {
            this.markNeuronActive(ownerNeuron.id);
        }

        this.processResponse(undefined, signal);
    }
}
