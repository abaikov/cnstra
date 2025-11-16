import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSSubscriber } from './types/TCNSSubscriber';
import { TCNSDendrite } from './types/TCNSDendrite';
import { CNSCollateral } from './CNSCollateral';

export class CNSNetwork<
    TCollateralName extends string,
    TNeuronName extends string,
    TNeuron extends TCNSNeuron<any, TNeuronName, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> {
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

    /**
     * Fast lookup: collateralName -> list of (neuron, dendrite) subscribers.
     * Built once at construction time.
     */
    private subIndex = new Map<
        TCollateralName,
        TCNSSubscriber<TNeuron, TDendrite>[]
    >();

    private neuronIndex = new Map<TNeuronName, TNeuron>();
    private dendriteIndex = new Map<TCollateralName, TDendrite>();
    private collateralIndex = new Map<
        TCollateralName,
        CNSCollateral<TCollateralName, unknown>
    >();

    private parentNeuronByCollateralName = new Map<TCollateralName, TNeuron>();

    constructor(private readonly neurons: TNeuron[]) {
        this.validateUniqueIdentifiers();
        this.buildIndexes();
        this.buildSCC();
    }

    /**
     * Validate uniqueness constraints:
     * - neuron names are unique and non-empty
     * - axon collateral types are globally unique (single owner)
     * - the same collateral instance cannot be owned by multiple neurons
     * Throws aggregated error if violations are found.
     */
    private validateUniqueIdentifiers(): void {
        const errors: string[] = [];
        const seenNeuronNames = new Set<string>();

        for (const neuron of this.neurons) {
            const name = (neuron?.name as unknown as string) ?? '';
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                errors.push(`Neuron has empty or invalid name: "${name}"`);
            } else if (seenNeuronNames.has(name)) {
                errors.push(`Duplicate neuron name: "${name}"`);
            } else {
                seenNeuronNames.add(name);
            }
        }

        if (errors.length > 0) {
            throw new Error(
                `[CNS] Topology uniqueness validation failed:\n - ` +
                    errors.join(`\n - `)
            );
        }
    }

    /**
     * Build the neuron graph where neurons are connected if one can stimulate the other.
     */
    private buildNeuronGraph(): Map<string, Set<string>> {
        const graph = new Map<string, Set<string>>();
        const neuronIds = this.neurons.map(n => n.name);

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
                const collateralName = collateral.name as TCollateralName;

                // Find which neurons listen to this collateral
                const subscribers = this.subIndex.get(collateralName);
                if (subscribers) {
                    for (const { neuron: targetNeuron } of subscribers) {
                        reachableNeurons.add(targetNeuron.name);
                    }
                }
            }

            graph.set(neuron.name, reachableNeurons);
        }

        return graph;
    }

    /**
     * Build strongly connected components using Tarjan's algorithm.
     */
    private buildSCC(): void {
        const graph = this.buildNeuronGraph();
        const neuronIds = this.neurons.map(n => n.name);

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
            for (const neighbor of Array.from(neighbors)) {
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
    private buildSCCDAG(neuronGraph: Map<string, Set<string>>): void {
        this.sccDag.clear();

        // Initialize DAG
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            this.sccDag.set(i, new Set());
        }

        // Build edges between SCCs
        for (let i = 0; i < this.stronglyConnectedComponents.length; i++) {
            const scc = this.stronglyConnectedComponents[i];

            for (const neuronId of Array.from(scc)) {
                const neighbors = neuronGraph.get(neuronId) || new Set();

                for (const neighborId of Array.from(neighbors)) {
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
    public getSCCSetByNeuronName(neuronName: string) {
        const sccIndex = this.neuronToSCC.get(neuronName);

        if (sccIndex === undefined) return;

        return this.stronglyConnectedComponents[sccIndex];
    }

    /**
     * Get the SCC index for a given neuron ID
     */
    public getSccIndexByNeuronName(neuronName: string): number | undefined {
        return this.neuronToSCC.get(neuronName);
    }

    /**
     * Check if a neuron can be guaranteed not to be visited again during the current propagation.
     * This is the core logic for safe context cleanup.
     */
    public canNeuronBeGuaranteedDone(
        neuronName: string,
        activeSccCounts: Map<number, number>
    ): boolean {
        const sccIndex = this.neuronToSCC.get(neuronName);
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
        this.parentNeuronByCollateralName.clear();
        for (const neuron of this.neurons) {
            this.neuronIndex.set(neuron.name, neuron);
            for (const dendrite of neuron.dendrites) {
                const key = dendrite.collateral.name as TCollateralName;
                const arr = this.subIndex.get(key) ?? [];
                arr.push({ neuron, dendrite: dendrite as TDendrite });
                this.subIndex.set(
                    key,
                    arr as TCNSSubscriber<TNeuron, TDendrite>[]
                );
                this.dendriteIndex.set(key, dendrite as TDendrite);
            }
            Object.values(neuron.axon).forEach(collateral => {
                this.parentNeuronByCollateralName.set(
                    (collateral as CNSCollateral<TCollateralName, unknown>)
                        .name,
                    neuron
                );
                this.collateralIndex.set(
                    (collateral as CNSCollateral<TCollateralName, unknown>)
                        .name,
                    collateral as CNSCollateral<TCollateralName, unknown>
                );
            });
        }
    }

    public getParentNeuronByCollateralName(collateralName: TCollateralName) {
        return this.parentNeuronByCollateralName.get(collateralName);
    }

    public getDendrites() {
        return Array.from(this.dendriteIndex.values());
    }

    public getCollaterals() {
        return Array.from(this.collateralIndex.values());
    }

    public getNeurons() {
        return Array.from(this.neuronIndex.values());
    }

    public getCollateralByName<TName extends string = string>(
        collateralName: TName
    ) {
        return this.collateralIndex.get(
            collateralName as unknown as TCollateralName
        ) as unknown as CNSCollateral<TName, unknown> | undefined;
    }

    public getNeuronByName<TName extends string = string>(neuronName: TName) {
        return this.neuronIndex.get(neuronName as unknown as TNeuronName);
    }

    public getSubscribers(
        collateralName: TCollateralName
    ): TCNSSubscriber<TNeuron, TDendrite>[] {
        return this.subIndex.get(collateralName) ?? [];
    }
}
