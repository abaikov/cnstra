import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { TCNSDendrite } from './types/TCNSDendrite';
import { CNSCollateral } from './CNSCollateral';

export class CNSNetwork<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any>
> {
    /**
     * Strongly Connected Components of the neuron graph.
     * Each component is a set of neuron objects that can reach each other.
     */
    public stronglyConnectedComponents: Set<TNeuron>[] = [];

    /**
     * Quick lookup: neuron -> SCC index for fast reachability checks.
     */
    private neuronToSCC = new Map<TNeuron, number>();

    /**
     * DAG of SCCs: SCC index -> set of SCC indices that can reach this SCC
     */
    private sccDag: Map<number, Set<number>> = new Map();

    /**
     * Precomputed ancestor sets for each SCC for fast reachability checks
     */
    private sccAncestors: Map<number, Set<number>> = new Map();

    /**
     * Fast lookup: collateral -> list of (neuron, dendrite) subscribers.
     * Built once at construction time.
     */
    private subIndex = new Map<
        CNSCollateral<unknown>,
        TCNSSubscriber<TNeuron, TDendrite>[]
    >();

    private dendriteIndex = new Map<CNSCollateral<unknown>, TDendrite>();
    private collateralIndex = new Set<CNSCollateral<unknown>>();

    private parentNeuronByCollateral = new Map<CNSCollateral<unknown>, TNeuron>();

    constructor(private readonly neurons: TNeuron[]) {
        this.validateUniqueIdentifiers();
        this.buildIndexes();
        this.buildSCC();
    }

    /**
     * Validate uniqueness constraints:
     * - (legacy) collateral instances used to be single-owner; in object-identity routing
     *   a collateral can be emitted by multiple neurons (fan-in), so we no longer
     *   enforce single ownership here.
     * Throws aggregated error if violations are found.
     */
    private validateUniqueIdentifiers(): void {
        // Intentionally no-op.
    }

    /**
     * Build the neuron graph where neurons are connected if one can stimulate the other.
     */
    private buildNeuronGraph(): Map<TNeuron, Set<TNeuron>> {
        const graph = new Map<TNeuron, Set<TNeuron>>();

        // Initialize graph
        for (const neuron of this.neurons) {
            graph.set(neuron, new Set());
        }

        // Build edges: neuron -> neurons it can reach via its axons
        for (const neuron of this.neurons) {
            const reachableNeurons = new Set<TNeuron>();

            // Check what collaterals this neuron can emit
            for (const axonKey in neuron.axon) {
                const collateral = neuron.axon[axonKey];

                // Find which neurons listen to this collateral
                const subscribers = this.subIndex.get(
                    collateral as CNSCollateral<unknown>
                );
                if (subscribers) {
                    for (const { neuron: targetNeuron } of subscribers) {
                        reachableNeurons.add(targetNeuron);
                    }
                }
            }

            graph.set(neuron, reachableNeurons);
        }

        return graph;
    }

    /**
     * Build strongly connected components using Tarjan's algorithm.
     */
    private buildSCC(): void {
        const graph = this.buildNeuronGraph();

        // Tarjan's algorithm for SCC
        const index = new Map<TNeuron, number>();
        const lowlink = new Map<TNeuron, number>();
        const onStack = new Set<TNeuron>();
        const stack: TNeuron[] = [];
        const components: Set<TNeuron>[] = [];
        let currentIndex = 0;

        const strongConnect = (neuron: TNeuron) => {
            index.set(neuron, currentIndex);
            lowlink.set(neuron, currentIndex);
            currentIndex++;
            stack.push(neuron);
            onStack.add(neuron);

            const neighbors = graph.get(neuron) || new Set();
            for (const neighbor of Array.from(neighbors)) {
                if (!index.has(neighbor)) {
                    strongConnect(neighbor);
                    lowlink.set(
                        neuron,
                        Math.min(lowlink.get(neuron)!, lowlink.get(neighbor)!)
                    );
                } else if (onStack.has(neighbor)) {
                    lowlink.set(
                        neuron,
                        Math.min(lowlink.get(neuron)!, index.get(neighbor)!)
                    );
                }
            }

            if (lowlink.get(neuron) === index.get(neuron)) {
                const component = new Set<TNeuron>();
                let w: TNeuron;
                do {
                    w = stack.pop()!;
                    onStack.delete(w);
                    component.add(w);
                } while (w !== neuron);
                components.push(component);
            }
        };

        // Run Tarjan's algorithm on all unvisited neurons
        for (const neuron of this.neurons) {
            if (!index.has(neuron)) {
                strongConnect(neuron);
            }
        }

        this.stronglyConnectedComponents = components;

        // Build quick lookup map for reachability checks
        for (let i = 0; i < components.length; i++) {
            for (const neuronId of Array.from(components[i])) {
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
    private buildSCCDAG(neuronGraph: Map<TNeuron, Set<TNeuron>>): void {
        this.sccDag.clear();

        // Initialize DAG
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            this.sccDag.set(i, new Set());
        }

        // Build edges between SCCs
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            const scc = this.stronglyConnectedComponents[i];

            for (const neuron of Array.from(scc)) {
                const neighbors = neuronGraph.get(neuron) || new Set();

                for (const neighbor of Array.from(neighbors)) {
                    const neighborSccIndex = this.neuronToSCC.get(neighbor);
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

            for (const neighbor of Array.from(outgoingEdges)) {
                // Add current as ancestor of neighbor
                const neighborAncestors = this.sccAncestors.get(neighbor)!;
                neighborAncestors.add(current);

                // Add all ancestors of current to neighbor
                const currentAncestors = this.sccAncestors.get(current)!;
                for (const ancestor of Array.from(currentAncestors)) {
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
        for (const [targetScc, incomingEdges] of Array.from(this.sccDag)) {
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
    public getSCCSetByNeuron(neuron: TNeuron) {
        const sccIndex = this.neuronToSCC.get(neuron);

        if (sccIndex === undefined) return;

        return this.stronglyConnectedComponents[sccIndex];
    }

    /**
     * Get the SCC index for a given neuron
     */
    public getSccIndexByNeuron(neuron: TNeuron): number | undefined {
        return this.neuronToSCC.get(neuron);
    }

    /**
     * Check if a neuron can be guaranteed not to be visited again during the current propagation.
     * This is the core logic for safe context cleanup.
     */
    public canNeuronBeGuaranteedDone(
        neuron: TNeuron,
        activeSccCounts: Map<number, number>
    ): boolean {
        const sccIndex = this.neuronToSCC.get(neuron);
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

        for (const ancestorSccIndex of Array.from(ancestors)) {
            if (
                activeSccCounts.get(ancestorSccIndex) &&
                activeSccCounts.get(ancestorSccIndex)! > 0
            ) {
                return false; // An active ancestor can still reach this SCC
            }
        }

        return true; // Neuron is guaranteed to be done
    }

    private buildIndexes() {
        this.subIndex.clear();
        this.parentNeuronByCollateral.clear();
        this.dendriteIndex.clear();
        this.collateralIndex.clear();
        for (const neuron of this.neurons) {
            for (const dendrite of neuron.dendrites) {
                const key = dendrite.collateral as CNSCollateral<unknown>;
                const arr = this.subIndex.get(key) ?? [];
                arr.push({ neuron, dendrite: dendrite as TDendrite });
                this.subIndex.set(
                    key,
                    arr as TCNSSubscriber<TNeuron, TDendrite>[]
                );
                this.dendriteIndex.set(key, dendrite as TDendrite);
            }
            Object.values(neuron.axon).forEach(collateral => {
                this.parentNeuronByCollateral.set(
                    collateral as CNSCollateral<unknown>,
                    neuron
                );
                this.collateralIndex.add(collateral as CNSCollateral<unknown>);
            });
        }
    }

    public getParentNeuronByCollateral(collateral: CNSCollateral<unknown>) {
        return this.parentNeuronByCollateral.get(collateral);
    }

    public getDendrites() {
        return Array.from(this.dendriteIndex.values());
    }

    public getCollaterals() {
        return Array.from(this.collateralIndex.values());
    }

    public getSubscribers(
        collateral: CNSCollateral<unknown>
    ): TCNSSubscriber<TNeuron, TDendrite>[] {
        return this.subIndex.get(collateral) ?? [];
    }
}
