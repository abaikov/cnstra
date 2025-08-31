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
    public stronglyConnectedComponents: Set<string>[] = [];

    /**
     * Quick lookup: neuron ID -> SCC index for fast reachability checks.
     */
    private neuronToSCC = new Map<string, number>();

    /**
     * DAG of SCCs: SCC index -> set of SCC indices that can reach this SCC
     */
    private sccDag: Map<number, Set<number>> = new Map();

    /**
     * Precomputed ancestor sets for each SCC for fast reachability checks
     */
    private sccAncestors: Map<number, Set<number>> = new Map();

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

        // Build DAG between SCCs
        this.buildSCCDAG(graph);

        // Precompute ancestor sets for fast reachability checks
        this.buildSCCAncestors();
    }

    /**
     * Build DAG between SCCs based on the original neuron graph
     */
    private buildSCCDAG(neuronGraph: Map<string, Set<string>>): void {
        this.sccDag.clear();

        // Initialize DAG
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            this.sccDag.set(i, new Set());
        }

        // Build edges between SCCs
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            const scc = this.stronglyConnectedComponents[i];

            for (const neuronId of scc) {
                const neighbors = neuronGraph.get(neuronId) || new Set();

                for (const neighborId of neighbors) {
                    const neighborSccIndex = this.neuronToSCC.get(neighborId);
                    if (
                        neighborSccIndex !== undefined &&
                        neighborSccIndex !== i
                    ) {
                        // Add edge: neighborSccIndex -> i (neighbor can reach this SCC)
                        this.sccDag.get(neighborSccIndex)!.add(i);
                    }
                }
            }
        }
    }

    /**
     * Precompute ancestor sets for each SCC for fast reachability checks
     * Uses topological sort for efficient computation
     */
    private buildSCCAncestors(): void {
        this.sccAncestors.clear();

        // Initialize ancestor sets
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            this.sccAncestors.set(i, new Set());
        }

        // Topological sort to compute ancestors efficiently
        const inDegree = new Map<number, number>();
        const queue: number[] = [];

        // Calculate in-degrees
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            const incomingEdges = this.sccDag.get(i) || new Set();
            inDegree.set(i, incomingEdges.size);

            if (incomingEdges.size === 0) {
                queue.push(i);
            }
        }

        // Process nodes in topological order
        while (queue.length > 0) {
            const current = queue.shift()!;
            const outgoingEdges = this.getOutgoingEdges(current);

            for (const neighbor of outgoingEdges) {
                // Add current as ancestor of neighbor
                const neighborAncestors = this.sccAncestors.get(neighbor)!;
                neighborAncestors.add(current);

                // Add all ancestors of current to neighbor
                const currentAncestors = this.sccAncestors.get(current)!;
                for (const ancestor of currentAncestors) {
                    neighborAncestors.add(ancestor);
                }

                // Decrease in-degree
                const newInDegree = (inDegree.get(neighbor) || 0) - 1;
                inDegree.set(neighbor, newInDegree);

                if (newInDegree === 0) {
                    queue.push(neighbor);
                }
            }
        }
    }

    /**
     * Get outgoing edges for a given SCC index
     */
    private getOutgoingEdges(sccIndex: number): Set<number> {
        const outgoing = new Set<number>();

        // Find all SCCs that have this SCC as an incoming edge
        for (const [targetScc, incomingEdges] of this.sccDag) {
            if (incomingEdges.has(sccIndex)) {
                outgoing.add(targetScc);
            }
        }

        return outgoing;
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

    /**
     * Get the SCC index for a given neuron ID
     */
    public getSccIndexByNeuronId(neuronId: string): number | undefined {
        return this.neuronToSCC.get(neuronId);
    }

    /**
     * Check if a neuron can be guaranteed not to be visited again during the current propagation.
     * This is the core logic for safe context cleanup.
     */
    public canNeuronBeGuaranteedDone(
        neuronId: string,
        activeSccCounts: Map<number, number>
    ): boolean {
        const sccIndex = this.neuronToSCC.get(neuronId);
        if (sccIndex === undefined) return true; // Neuron not in graph

        // Check if this SCC is still active
        if (
            activeSccCounts.get(sccIndex) &&
            activeSccCounts.get(sccIndex)! > 0
        ) {
            return false; // SCC is still active
        }

        // Check if any active SCC can reach this SCC
        const ancestors = this.sccAncestors.get(sccIndex);
        if (!ancestors) return true;

        for (const ancestorSccIndex of ancestors) {
            if (
                activeSccCounts.get(ancestorSccIndex) &&
                activeSccCounts.get(ancestorSccIndex)! > 0
            ) {
                return false; // An active ancestor can still reach this SCC
            }
        }

        return true; // Neuron is guaranteed to be done
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
