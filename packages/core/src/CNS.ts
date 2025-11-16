import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { TCNSOptions } from './types/TCNSOptions';
import { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
import { CNSStimulation } from './CNSStimulation';
import { TCNSSignal } from './types/TCNSSignal';
import { CNSInstanceNeuronQueue } from './CNSInstanceNeuronQueue';
import { TCNSStimulationResponse } from './types/TCNSStimulationResponse';
import { TCNSNeuronActivationTask } from './types/TCNSNeuronActivationTask';
import { CNSNetwork } from './CNSNetwork';
import { ICNS } from './interfaces/ICNS';

export class CNS<
    TCollateralName extends string,
    TNeuronName extends string,
    TNeuron extends TCNSNeuron<any, TNeuronName, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> implements
        Omit<
            ICNS<TCollateralName, TNeuronName, TNeuron, TDendrite>,
            'stimulate'
        >
{
    /**
     * Network graph analysis and strongly connected components.
     */
    public readonly network: CNSNetwork<
        TCollateralName,
        TNeuronName,
        TNeuron,
        TDendrite
    >;

    /**
     * Global per-neuron concurrency gates shared across all stimulations.
     */
    private readonly neuronGates = new Map<
        TNeuronName,
        { limit: number; active: number; waiters: (() => void)[] }
    >();

    /**
     * Global task queue used by stimulation to schedule per-neuron gated work.
     * Does not replace per-stimulation concurrency; only coordinates global per-neuron limits.
     */
    protected readonly instanceNeuronQueue =
        new CNSInstanceNeuronQueue<TNeuron>();

    /**
     * Global response listeners applied to every stimulation.
     */
    private readonly globalResponseListeners: Array<
        (r: any) => void | Promise<void>
    > = [];

    constructor(
        protected readonly neurons: TNeuron[],
        public readonly options?: TCNSOptions
    ) {
        this.network = new CNSNetwork(this.neurons);
    }

    public addResponseListener<TInputPayload, TOutputPayload>(
        listener: (
            response: TCNSStimulationResponse<
                TCollateralName,
                TInputPayload,
                TOutputPayload,
                TNeuronName
            >
        ) => void | Promise<void>
    ): () => void {
        this.globalResponseListeners.push(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            const idx = this.globalResponseListeners.indexOf(listener);
            if (idx >= 0) this.globalResponseListeners.splice(idx, 1);
        };
    }

    private wrapOnResponse<T>(
        local?: (response: T) => void | Promise<void>
    ): (response: T) => void | Promise<void> {
        if (this.globalResponseListeners.length === 0 && !local) {
            // No-op fast path
            return () => {};
        }
        return (r: T) => {
            let anyPromise = false;
            const promises: Promise<void>[] = [];

            if (local) {
                try {
                    const res = local(r);
                    if (res && typeof (res as any).then === 'function') {
                        anyPromise = true;
                        promises.push(res as Promise<void>);
                    }
                } catch (error) {
                    // Sync error from local - wrap in rejected promise
                    anyPromise = true;
                    promises.push(Promise.reject(error));
                }
            }

            for (let i = 0; i < this.globalResponseListeners.length; i++) {
                try {
                    const res = this.globalResponseListeners[i](r);
                    if (res && typeof (res as any).then === 'function') {
                        anyPromise = true;
                        promises.push(res as Promise<void>);
                    }
                } catch (error) {
                    // Sync error from global listener - wrap in rejected promise
                    anyPromise = true;
                    promises.push(Promise.reject(error));
                }
            }

            if (anyPromise) {
                return Promise.allSettled(promises).then(results => {
                    const rejected = results.find(
                        r => r.status === 'rejected'
                    ) as PromiseRejectedResult | undefined;
                    if (rejected) throw rejected.reason;
                });
            }
        };
    }

    public stimulate<
        TInputPayload extends TOutputPayload,
        TOutputPayload = TInputPayload
    >(
        signalOrSignals:
            | TCNSSignal<TCollateralName, TInputPayload>
            | TCNSSignal<TCollateralName, TInputPayload>[],
        options?: TCNSStimulationOptions<
            TCollateralName,
            TInputPayload,
            TOutputPayload,
            TNeuronName,
            TNeuron,
            TDendrite
        >
    ): CNSStimulation<
        TCollateralName,
        TNeuronName,
        TNeuron,
        TDendrite,
        TInputPayload,
        TOutputPayload
    > {
        const wrapped = this.wrapOnResponse(options?.onResponse);
        const stimulation = new CNSStimulation<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite,
            TInputPayload,
            TOutputPayload
        >(this, this.instanceNeuronQueue, {
            ...options,
            onResponse: wrapped,
        });
        stimulation.responseToSignal(signalOrSignals);
        return stimulation;
    }

    /**
     * Start a stimulation with activation tasks directly
     */
    public activate<TInputPayload, TOutputPayload>(
        tasks: TCNSNeuronActivationTask<TCollateralName, TNeuronName>[],
        options?: TCNSStimulationOptions<
            TCollateralName,
            TInputPayload,
            TOutputPayload,
            TNeuronName,
            TNeuron,
            TDendrite
        >
    ): CNSStimulation<
        TCollateralName,
        TNeuronName,
        TNeuron,
        TDendrite,
        TInputPayload,
        TOutputPayload
    > {
        const wrapped = this.wrapOnResponse(options?.onResponse);
        const stimulation = new CNSStimulation<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite,
            TInputPayload,
            TOutputPayload
        >(this, this.instanceNeuronQueue, {
            ...options,
            onResponse: wrapped,
        });
        stimulation.enqueueTasks(tasks);
        return stimulation;
    }
}
