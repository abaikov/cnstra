import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { ICNS } from './interfaces/ICNS';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { TCNSOptions } from './types/TCNSOptions';
import { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
import { CNSStimulation } from './CNSStimulation';
import { CNSCollateral } from './CNSCollateral';
import { TCNSSignal } from './types/TCNSSignal';

export class CNS<
    TCollateralId extends string,
    TNeuronId extends string,
    TNeuron extends TCNSNeuron<any, TNeuronId, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> implements ICNS<TNeuron, TDendrite>
{
    /**
     * Fast lookup: collateralId -> list of (neuron, dendrite) subscribers.
     * Built once at construction time.
     */
    private subIndex = new Map<
        TCollateralId,
        TCNSSubscriber<TNeuron, TDendrite>[]
    >();

    private parentNeuronByCollateralId = new Map<TCollateralId, TNeuron>();

    /**
     * Strongly Connected Components of the neuron graph.
     * Each component is a set of neuron IDs that can reach each other.
     */
    private stronglyConnectedComponents: Set<string>[] = [];

    /**
     * Quick lookup: neuron ID -> SCC index for fast reachability checks.
     */
    private neuronToSCC = new Map<string, number>();

    constructor(
        protected readonly neurons: TNeuron[],
        public readonly options?: TCNSOptions
    ) {
        this.buildIndexes();
        if (this.options?.autoCleanupContexts) {
            this.buildSCC();
        }
    }

    private buildIndexes() {
        this.subIndex.clear();
        this.parentNeuronByCollateralId.clear();
        for (const neuron of this.neurons) {
            for (const dendrite of neuron.dendrites) {
                const key = dendrite.collateral.id as TCollateralId;
                const arr = this.subIndex.get(key) ?? [];
                arr.push({ neuron, dendrite: dendrite as TDendrite });
                this.subIndex.set(
                    key,
                    arr as TCNSSubscriber<TNeuron, TDendrite>[]
                );
            }
            Object.values(neuron.axon).forEach(collateral => {
                this.parentNeuronByCollateralId.set(
                    (collateral as CNSCollateral<TCollateralId, unknown>).id,
                    neuron
                );
            });
        }
    }

    /**
     * Build the neuron graph where neurons are connected if one can stimulate the other.
     */
    private buildNeuronGraph(): Map<string, Set<string>> {
        const graph = new Map<string, Set<string>>();
        const neuronIds = this.neurons.map(n => n.id);

        // Initialize graph
        for (const neuronId of neuronIds) {
            graph.set(neuronId, new Set());
        }

        // Build edges: neuron -> neurons it can reach via its axons
        for (const neuron of this.neurons) {
            const reachableNeurons = new Set<string>();

            // Check what collaterals this neuron can emit
            for (const axonKey in neuron.axon) {
                const collateral = neuron.axon[axonKey];
                const collateralId = collateral.id as TCollateralId;

                // Find which neurons listen to this collateral
                const subscribers = this.subIndex.get(collateralId);
                if (subscribers) {
                    for (const { neuron: targetNeuron } of subscribers) {
                        reachableNeurons.add(targetNeuron.id);
                    }
                }
            }

            graph.set(neuron.id, reachableNeurons);
        }

        return graph;
    }

    /**
     * Build strongly connected components using Tarjan's algorithm.
     */
    private buildSCC(): void {
        const graph = this.buildNeuronGraph();
        const neuronIds = this.neurons.map(n => n.id);

        // Tarjan's algorithm for SCC
        const index = new Map<string, number>();
        const lowlink = new Map<string, number>();
        const onStack = new Set<string>();
        const stack: string[] = [];
        const components: Set<string>[] = [];
        let currentIndex = 0;

        const strongConnect = (neuronId: string) => {
            index.set(neuronId, currentIndex);
            lowlink.set(neuronId, currentIndex);
            currentIndex++;
            stack.push(neuronId);
            onStack.add(neuronId);

            const neighbors = graph.get(neuronId) || new Set();
            for (const neighbor of neighbors) {
                if (!index.has(neighbor)) {
                    strongConnect(neighbor);
                    lowlink.set(
                        neuronId,
                        Math.min(lowlink.get(neuronId)!, lowlink.get(neighbor)!)
                    );
                } else if (onStack.has(neighbor)) {
                    lowlink.set(
                        neuronId,
                        Math.min(lowlink.get(neuronId)!, index.get(neighbor)!)
                    );
                }
            }

            if (lowlink.get(neuronId) === index.get(neuronId)) {
                const component = new Set<string>();
                let w: string;
                do {
                    w = stack.pop()!;
                    onStack.delete(w);
                    component.add(w);
                } while (w !== neuronId);
                components.push(component);
            }
        };

        // Run Tarjan's algorithm on all unvisited neurons
        for (const neuronId of neuronIds) {
            if (!index.has(neuronId)) {
                strongConnect(neuronId);
            }
        }

        this.stronglyConnectedComponents = components;

        // Build quick lookup map for reachability checks
        for (let i = 0; i < components.length; i++) {
            for (const neuronId of components[i]) {
                this.neuronToSCC.set(neuronId, i);
            }
        }
    }

    /**
     * Check if a neuron can be reached again (including self-calling).
     * Returns true if the neuron is in a strongly connected component with more than one member,
     * or if it's in a single-member SCC that can reach itself.
     */
    public getSCCSetByNeuronId(neuronId: string) {
        const sccIndex = this.neuronToSCC.get(neuronId);

        if (sccIndex === undefined) return;

        return this.stronglyConnectedComponents[sccIndex];
    }

    public getParentNeuronByCollateralId(collateralId: TCollateralId) {
        return this.parentNeuronByCollateralId.get(collateralId);
    }

    public getSubscribers(
        collateralId: TCollateralId
    ): TCNSSubscriber<TNeuron, TDendrite>[] {
        return this.subIndex.get(collateralId) ?? [];
    }

    public stimulate<TInputPayload extends TOutputPayload, TOutputPayload>(
        signal: TCNSSignal<TCollateralId, TInputPayload>,
        options?: TCNSStimulationOptions<
            TCollateralId,
            TInputPayload,
            TOutputPayload
        >
    ) {
        const stimulation = new CNSStimulation<
            TCollateralId,
            TNeuronId,
            TNeuron,
            TDendrite,
            TInputPayload,
            TOutputPayload
        >(this, options);
        stimulation.responseToSignal(signal);
    }
}
