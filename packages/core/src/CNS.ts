import type { ICNSCollateral } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import { TCNSDendrite } from '@cnstra/types';
import { TCNSOptions } from '@cnstra/types';
import { TCNSStimulationOptions } from '@cnstra/types';
import { CNSStimulation } from './CNSStimulation';
import { TCNSSignal } from '@cnstra/types';
import { CNSInstanceNeuronQueue } from './CNSInstanceNeuronQueue';
import { TCNSStimulationResponse } from '@cnstra/types';
import { TCNSStimulationDrain } from '@cnstra/types';
import { TCNSNeuronActivationTask } from '@cnstra/types';
import { CNSNetwork } from './CNSNetwork';
import { ICNS } from '@cnstra/types';

export class CNS<
    TNeuron extends TCNSNeuron<any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> implements ICNS<TNeuron, TDendrite>
{
    /**
     * Network graph analysis and strongly connected components.
     */
    public readonly network: CNSNetwork<TNeuron, TDendrite>;

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

    /**
     * Global batch-boundary listeners applied to every stimulation.
     */
    private readonly globalDrainListeners: Array<
        (d: TCNSStimulationDrain) => void
    > = [];

    private batchDepth = 0;

    private batchedDrains: [announce: (drain: TCNSStimulationDrain) => void, drain: TCNSStimulationDrain][] = [];

    /**
     * Shared, app/organism-wide value handed to every dendrite as `ctx.global`.
     * Stored untyped (the type is baked into neurons via `cnsNeuronFactory().withGlobal<T>()`);
     * CNS is just a passthrough carrier, so injecting it here never touches the hot path.
     */
    public readonly global?: unknown;

    constructor(
        protected readonly neurons: TNeuron[],
        public readonly options?: TCNSOptions,
        global?: unknown
    ) {
        this.network = new CNSNetwork(this.neurons);
        this.global = global;
    }

    /** Push a listener onto a list; return an idempotent unsubscribe. */
    private addListener<T>(list: T[], listener: T): () => void {
        list.push(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            const idx = list.indexOf(listener);
            if (idx >= 0) list.splice(idx, 1);
        };
    }

    public addResponseListener(
        listener: (response: TCNSStimulationResponse) => void | Promise<void>
    ): () => void {
        return this.addListener(this.globalResponseListeners, listener);
    }

    /**
     * Register a listener called once at the end of every synchronous turn of
     * every stimulation (inside `batch`, when the batch ends) - see {@link TCNSStimulationDrain}. This is how an
     * integration (a state manager, an in-memory database) installs a single
     * commit point for the whole organism instead of passing `onDrain` per call.
     *
     * Returns an unsubscribe function.
     */
    public addDrainListener(
        listener: (drain: TCNSStimulationDrain) => void
    ): () => void {
        return this.addListener(this.globalDrainListeners, listener);
    }

    public batch<TResult>(run: () => TResult): TResult {
        this.batchDepth++;
        try {
            return run();
        } finally {
            if (--this.batchDepth === 0) {
                const batchedDrains = this.batchedDrains;
                this.batchedDrains = [];
                for (const [announce, drain] of batchedDrains) announce(drain);
            }
        }
    }

    /**
     * Fan a drain out to the local and global listeners, or return undefined when
     * there are none so the stimulation can skip the boundary check entirely.
     *
     * Listener errors are isolated: a drain is a notification, and one broken
     * flush must not stop the others or derail the stimulation that triggered it.
     */
    private wrapOnDrain(
        local?: (drain: TCNSStimulationDrain) => void
    ): ((drain: TCNSStimulationDrain) => void) | undefined {
        if (this.globalDrainListeners.length === 0 && !local) return undefined;
        const announce = (d: TCNSStimulationDrain) => {
            if (local) {
                try {
                    local(d);
                } catch (error) {
                    console.error('[CNS] onDrain listener threw', error);
                }
            }
            for (let i = 0; i < this.globalDrainListeners.length; i++) {
                try {
                    this.globalDrainListeners[i](d);
                } catch (error) {
                    console.error('[CNS] drain listener threw', error);
                }
            }
        };
        return (d: TCNSStimulationDrain) => {
            if (this.batchDepth > 0) this.batchedDrains.push([announce, d]);
            else announce(d);
        };
    }

    private wrapOnResponse<T>(
        local?: (response: T) => void | Promise<void>
    ): ((response: T) => void | Promise<void>) | undefined {
        if (this.globalResponseListeners.length === 0 && !local) {
            // No listener at all: skip wrapping entirely so the stimulation can
            // take its fast path and avoid building response objects per signal.
            return undefined;
        }
        return (r: T) => {
            // Allocated on first need, not on every response: all three of our
            // own listeners (devtools, otel metrics, otel tracing) are
            // synchronous, and this runs once per signal.
            let promises: Promise<void>[] | undefined;

            if (local) {
                try {
                    const res = local(r);
                    if (res && typeof (res as any).then === 'function') {
                        (promises ??= []).push(res as Promise<void>);
                    }
                } catch (error) {
                    // Sync error from local - wrap in rejected promise
                    (promises ??= []).push(Promise.reject(error));
                }
            }

            for (let i = 0; i < this.globalResponseListeners.length; i++) {
                try {
                    const res = this.globalResponseListeners[i](r);
                    if (res && typeof (res as any).then === 'function') {
                        (promises ??= []).push(res as Promise<void>);
                    }
                } catch (error) {
                    // Sync error from global listener - wrap in rejected promise
                    (promises ??= []).push(Promise.reject(error));
                }
            }

            if (promises) {
                return Promise.allSettled(promises).then(results => {
                    const rejected = results.find(
                        r => r.status === 'rejected'
                    ) as PromiseRejectedResult | undefined;
                    if (rejected) throw rejected.reason;
                });
            }
        };
    }

    /** Build a stimulation (wired listeners, unseeded). Shared by stimulate/activate. */
    private createStimulation(
        options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ): CNSStimulation<TNeuron, TDendrite> {
        return new CNSStimulation<TNeuron, TDendrite>(
            this,
            this.instanceNeuronQueue,
            options,
            this.wrapOnResponse(options?.onResponse),
            this.wrapOnDrain(options?.onDrain)
        );
    }

    public stimulate(
        signalOrSignals:
            | TCNSSignal<ICNSCollateral<unknown>>
            | TCNSSignal<ICNSCollateral<unknown>>[],
        options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ): CNSStimulation<TNeuron, TDendrite> {
        const stimulation = this.createStimulation(options);
        stimulation.responseToSignal(signalOrSignals);
        return stimulation;
    }

    /**
     * Start a stimulation with activation tasks directly
     */
    public activate(
        tasks: TCNSNeuronActivationTask<TNeuron>[],
        options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ): CNSStimulation<TNeuron, TDendrite> {
        const stimulation = this.createStimulation(options);
        stimulation.enqueueTasks(tasks);
        return stimulation;
    }
}
