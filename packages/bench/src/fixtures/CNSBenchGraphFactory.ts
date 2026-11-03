import {
    CNS,
    CNSPersistOptionsRegistry,
    cnsCollateral,
    cnsNeuron,
} from '../cnstra';
import type { ICNSCollateral } from '../cnstra';
import type { TCNSBenchGraph } from '../types/TCNSBenchGraph';
import type { TCNSBenchPayload } from '../types/TCNSBenchPayload';

/**
 * Builds the graph shapes the benchmarks run on.
 *
 * Three things are true of every graph here, and all three exist to keep the
 * measurement about the engine:
 *
 * - **the payload is one shared frozen object**, reused by every signal of every
 *   iteration, so no case is quietly measuring allocation of test data;
 * - **nothing is random** — neuron count, fan-out width and payload are all
 *   arguments, and no handler branches on anything but its own arguments;
 * - **every collateral is owned by the neuron that emits it**, and only the
 *   entry collateral is ownerless, which is what an entry collateral is. A graph
 *   that broke that rule would not be a graph CNStra is meant to run.
 *
 * Each graph also comes with a populated {@link CNSPersistOptionsRegistry},
 * because the persist and tracing benchmarks need names for the very same
 * objects and building a second, differently-shaped graph for them would make
 * their numbers incomparable with the engine's.
 */
export class CNSBenchGraphFactory {
    /**
     * The payload every benchmark signal carries. Frozen so a handler cannot
     * mutate it into a different hidden class halfway through a run.
     */
    static readonly payload: TCNSBenchPayload = Object.freeze({
        id: 4711,
        label: 'bench',
        tags: Object.freeze(['alpha', 'beta']) as string[],
        nested: Object.freeze({ attempt: 1, flag: true }),
    }) as TCNSBenchPayload;

    /**
     * `hops` neurons in a line: the entry collateral feeds the first, each one
     * emits the collateral the next consumes, and the last emits a collateral
     * nobody listens to. One stimulation therefore runs exactly `hops` dendrite
     * bodies and creates `hops` signals.
     *
     * `async` makes every handler return an already-resolved promise. That is
     * the cheapest possible asynchronous handler, which is the point: what it
     * measures is the engine's async path — the queue parking, the microtask per
     * activation — and not whatever I/O a real handler would be waiting on.
     */
    static linearChain(
        hops: number,
        options: { async?: boolean } = {}
    ): TCNSBenchGraph {
        const collaterals: ICNSCollateral<TCNSBenchPayload>[] = [];
        for (let index = 0; index <= hops; index++) {
            collaterals.push(cnsCollateral<TCNSBenchPayload>());
        }

        let activations = 0;
        const neurons: any[] = [];
        for (let index = 0; index < hops; index++) {
            const out = collaterals[index + 1]!;
            const syncResponse = (payload: TCNSBenchPayload, axon: any) => {
                activations++;
                return axon.out.createSignal(payload);
            };
            const response = options.async
                ? async (payload: TCNSBenchPayload, axon: any) =>
                      syncResponse(payload, axon)
                : syncResponse;
            neurons.push(
                cnsNeuron({ out } as any).dendrite({
                    collateral: collaterals[index]!,
                    response,
                } as any)
            );
        }

        return CNSBenchGraphFactory.assemble({
            neurons,
            entryCollateral: collaterals[0]!,
            // Collateral index i+1 is neuron i's output.
            outputNames: neurons.map((_, index) => `c${index + 1}`),
            activationCount: () => activations,
            activationsPerStimulation: hops,
        });
    }

    /**
     * One entry collateral, `width` neurons listening to it, each emitting one
     * collateral nobody consumes. One stimulation runs `width` dendrite bodies
     * off a single signal — the shape that exercises the engine's dispatch and
     * its activation queue rather than its chaining.
     */
    static fanOut(width: number): TCNSBenchGraph {
        const entryCollateral = cnsCollateral<TCNSBenchPayload>();
        let activations = 0;
        const neurons: any[] = [];
        for (let index = 0; index < width; index++) {
            const out = cnsCollateral<TCNSBenchPayload>();
            neurons.push(
                cnsNeuron({ out } as any).dendrite({
                    collateral: entryCollateral,
                    response: (payload: TCNSBenchPayload, axon: any) => {
                        activations++;
                        return axon.out.createSignal(payload);
                    },
                } as any)
            );
        }

        return CNSBenchGraphFactory.assemble({
            neurons,
            entryCollateral,
            outputNames: neurons.map((_, index) => `c${index + 1}`),
            activationCount: () => activations,
            activationsPerStimulation: width,
        });
    }

    /**
     * A fan-out whose every neuron throws.
     *
     * This is how a frontier is produced without stalling a run on a timer: the
     * engine records each throwing activation as a failed task, and a failed
     * task is part of the outstanding frontier — exactly the set a resume has to
     * serialize. It is also how the persist package's own tests capture one, so
     * the benchmark is snapshotting the same thing the tests assert on.
     */
    /**
     * A fan-out of `width` neurons that all throw, so a run stops with exactly
     * `width` activations outstanding.
     *
     * `registrySize` pads the registry with collaterals nothing uses. Without it
     * a family that varies `width` varies TWO things at once — the frontier and
     * the number of registered collaterals — and the growth exponent mixes the
     * per-task serialization work with however the registry's name lookup scales.
     * Hold it at the family's largest width and only the frontier varies.
     */
    static failingFanOut(width: number, registrySize?: number): TCNSBenchGraph {
        const entryCollateral = cnsCollateral<TCNSBenchPayload>();
        let activations = 0;
        const neurons: any[] = [];
        for (let index = 0; index < width; index++) {
            const out = cnsCollateral<TCNSBenchPayload>();
            neurons.push(
                cnsNeuron({ out } as any).dendrite({
                    collateral: entryCollateral,
                    response: () => {
                        activations++;
                        throw new Error('bench: intentional frontier stop');
                    },
                } as any)
            );
        }

        return CNSBenchGraphFactory.assemble({
            neurons,
            entryCollateral,
            outputNames: neurons.map((_, index) => `c${index + 1}`),
            activationCount: () => activations,
            activationsPerStimulation: width,
            padRegistryTo: registrySize,
        });
    }

    /**
     * Wrap built neurons into a CNS and register every neuron and collateral
     * under a distinct name.
     */
    private static assemble(input: {
        neurons: any[];
        entryCollateral: ICNSCollateral<TCNSBenchPayload>;
        outputNames: string[];
        activationCount: () => number;
        activationsPerStimulation: number;
        /** Register this many collaterals in total, padding with unused ones. */
        padRegistryTo?: number;
    }): TCNSBenchGraph {
        const cns = new CNS(input.neurons) as CNS<any, any>;
        const registry = new CNSPersistOptionsRegistry();
        const entryCollateralName = 'entry';
        registry.registerCollateral(
            entryCollateralName,
            input.entryCollateral as any
        );
        input.neurons.forEach((neuron, index) => {
            registry.register(`n${index}`, neuron, {
                out: input.outputNames[index],
            } as any);
        });

        // Padding, so a family that varies the graph can still hold the registry
        // constant. These are never emitted or consumed — they exist only to give
        // the registry's lookup the same amount of work in every case.
        const used = input.neurons.length + 1;
        for (let index = used; index < (input.padRegistryTo ?? 0) + 1; index++) {
            registry.registerCollateral(
                `pad${index}`,
                cnsCollateral<TCNSBenchPayload>() as any
            );
        }

        const payload = CNSBenchGraphFactory.payload;
        return {
            cns,
            entryCollateral: input.entryCollateral,
            entryCollateralName,
            registry,
            entryJSON: [{ collateralName: entryCollateralName, payload }],
            createEntrySignal: () => input.entryCollateral.createSignal(payload),
            activationCount: input.activationCount,
            activationsPerStimulation: input.activationsPerStimulation,
        };
    }
}
