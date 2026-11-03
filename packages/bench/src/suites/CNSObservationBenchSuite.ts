import {
    CNSInMemoryStimulationRepository,
    CNSStimulationPersistor,
    attachCNSOtelTracing,
} from '../cnstra';
import { CNSBenchGraphFactory } from '../fixtures/CNSBenchGraphFactory';
import { CNSBenchTracerFactory } from '../fixtures/CNSBenchTracerFactory';
import type { TCNSBenchCase } from '../types/TCNSBenchCase';
import type { TCNSBenchGraph } from '../types/TCNSBenchGraph';
import type { TCNSBenchSuite } from '../types/TCNSBenchSuite';

/**
 * What turning observation on costs.
 *
 * This is the suite with the most operational value, because these listeners run
 * on every single response of every single run, and because the first one of
 * them costs more than it looks: with no listener at all `CNS.wrapOnResponse`
 * hands the stimulation `undefined` and the engine skips building a response
 * object per signal entirely. Attaching ONE no-op listener does not add the cost
 * of that listener — it adds the cost of leaving the fast path. `observe/none`
 * against `observe/response-listener` is where that shows up.
 *
 * Every case here runs the SAME eight-neuron synchronous chain and awaits the
 * run to completion, including the baseline. Awaiting costs the baseline a
 * promise it would not otherwise need, and that is the point: the variants are
 * only comparable if they differ in exactly one thing, and a real caller awaits
 * its run anyway.
 *
 * Each case reports a ratio against `observe/none` as well as an absolute
 * figure. The ratio is the number to watch — it survives a change of machine,
 * where the nanoseconds do not.
 */
export class CNSObservationBenchSuite {
    /** Hops in the shared flow. Enough responses for a per-response cost to show. */
    private static readonly hops = 8;

    static create(): TCNSBenchSuite {
        return {
            name: 'observe',
            summary:
                'the price of watching a run — listener, persistor, tracing — on every response',
            cases: [
                CNSObservationBenchSuite.baselineCase(),
                CNSObservationBenchSuite.responseListenerCase(),
                CNSObservationBenchSuite.persistorCase({
                    id: 'observe/persistor-progress',
                    volume: 'progress',
                    barrier: false,
                    description:
                        'CNSStimulationPersistor at volume "progress" writing to an in-memory store (resume frontier only, debounced cadence)',
                }),
                CNSObservationBenchSuite.persistorCase({
                    id: 'observe/persistor-full',
                    volume: 'full',
                    barrier: false,
                    description:
                        'CNSStimulationPersistor at volume "full" writing to an in-memory store (frontier plus one task row per hop)',
                }),
                CNSObservationBenchSuite.persistorCase({
                    id: 'observe/persistor-full-barrier',
                    volume: 'full',
                    barrier: true,
                    description:
                        'CNSStimulationPersistor at volume "full" with barrier:true — every hop parked until its checkpoint has landed',
                }),
                CNSObservationBenchSuite.otelTracingCase(),
            ],
        };
    }

    /** Nothing attached: the engine's no-listener fast path, awaited like the rest. */
    private static baselineCase(): TCNSBenchCase {
        return {
            id: 'observe/none',
            operation: `one ${CNSObservationBenchSuite.hops}-hop synchronous run, awaited, with nothing observing it (engine fast path: no response object is built)`,
            prepare: () => {
                const graph = CNSBenchGraphFactory.linearChain(
                    CNSObservationBenchSuite.hops
                );
                const drive = () =>
                    graph.cns
                        .stimulate(graph.createEntrySignal(), {})
                        .waitUntilComplete();
                return {
                    run: drive,
                    verify: async () => {
                        const before = graph.activationCount();
                        await drive();
                        CNSObservationBenchSuite.assertActivations(
                            graph,
                            before
                        );
                    },
                };
            },
        };
    }

    /**
     * One global no-op response listener.
     *
     * The listener body does nothing but increment a counter, so the delta
     * against `observe/none` is almost entirely the engine's: a response object
     * per signal, the wrapper, the promise check. That is the floor under every
     * integration — devtools, metrics, anything.
     */
    private static responseListenerCase(): TCNSBenchCase {
        return {
            id: 'observe/response-listener',
            operation: `the same ${CNSObservationBenchSuite.hops}-hop run with one global no-op response listener attached`,
            relativeTo: 'observe/none',
            prepare: () => {
                const graph = CNSBenchGraphFactory.linearChain(
                    CNSObservationBenchSuite.hops
                );
                let observed = 0;
                const detach = graph.cns.addResponseListener(() => {
                    observed++;
                });
                const drive = () =>
                    graph.cns
                        .stimulate(graph.createEntrySignal(), {})
                        .waitUntilComplete();
                return {
                    run: drive,
                    verify: async () => {
                        const beforeActivations = graph.activationCount();
                        const beforeObserved = observed;
                        await drive();
                        CNSObservationBenchSuite.assertActivations(
                            graph,
                            beforeActivations
                        );
                        if (observed <= beforeObserved) {
                            throw new Error(
                                '[bench] the response listener never fired — this case is measuring the fast path, not the observed path'
                            );
                        }
                    },
                    teardown: () => detach(),
                };
            },
        };
    }

    /**
     * A persistor wired into the run, constructed fresh each iteration.
     *
     * Construction is inside the measured body deliberately: a persistor belongs
     * to one attempt of one run, so "turning persistence on" really does mean
     * paying for one of these per run, along with the id strings it needs. The
     * body also awaits `dispose()`, which is what hands back the outstanding
     * write chain — without it the measurement would stop at the point the
     * writes were queued rather than the point they landed.
     *
     * The measured store is configured with `deleteOnComplete`, which keeps it
     * flat across a long benchmark. Left unbounded it would grow a map entry per
     * iteration and the last samples would be measuring a different store than
     * the first.
     */
    private static persistorCase(input: {
        id: string;
        volume: 'progress' | 'full';
        barrier: boolean;
        description: string;
    }): TCNSBenchCase {
        return {
            id: input.id,
            operation: `the same ${CNSObservationBenchSuite.hops}-hop run plus ${input.description}, awaited through the persistor's write chain`,
            relativeTo: 'observe/none',
            prepare: () => {
                const graph = CNSBenchGraphFactory.linearChain(
                    CNSObservationBenchSuite.hops
                );
                const repository = new CNSInMemoryStimulationRepository({
                    deleteOnComplete: true,
                });
                let sequence = 0;

                const drive = async (
                    target: CNSInMemoryStimulationRepository
                ): Promise<string> => {
                    sequence++;
                    const stimulationId = `bench-stim-${sequence}`;
                    const persistor = new CNSStimulationPersistor({
                        repository: target,
                        registry: graph.registry,
                        stimulationId,
                        stimulationAttemptId: `${stimulationId}#1`,
                        attemptNumber: 1,
                        entry: graph.entryJSON,
                        volume: input.volume,
                        barrier: input.barrier,
                    });
                    const stimulation = graph.cns.stimulate(
                        graph.createEntrySignal(),
                        { onResponse: persistor.onResponse }
                    );
                    await stimulation.waitUntilComplete();
                    await persistor.dispose();
                    return stimulationId;
                };

                return {
                    run: () => drive(repository).then(() => undefined),
                    // Verified against its own retaining store, because the
                    // measured one throws the record away the moment it settles.
                    verify: async () => {
                        const audit = new CNSInMemoryStimulationRepository();
                        const before = graph.activationCount();
                        const stimulationId = await drive(audit);
                        CNSObservationBenchSuite.assertActivations(
                            graph,
                            before
                        );
                        const record = await audit.getStimulation(
                            stimulationId
                        );
                        if (!record || record.status !== 'completed') {
                            throw new Error(
                                `[bench] the persistor did not record a completed run for ${stimulationId}`
                            );
                        }
                        if (input.volume === 'full') {
                            const tasks = await audit.getTasks(
                                `${stimulationId}#1`
                            );
                            if (
                                tasks.length !==
                                CNSObservationBenchSuite.hops
                            ) {
                                throw new Error(
                                    `[bench] volume "full" recorded ${tasks.length} task rows, expected ${CNSObservationBenchSuite.hops}`
                                );
                            }
                        }
                    },
                };
            },
        };
    }

    /**
     * `attachCNSOtelTracing` over the same run.
     *
     * What this number is: what CNStra spends producing the trace — the global
     * listener on every hop, a span opened per scheduled activation, the
     * traceparent formatting, the context compartment written into each
     * activation's store, and the registry name lookups behind the span names.
     *
     * What it is NOT: the cost of running OpenTelemetry. The tracer here records
     * and drops. A real SDK adds sampling, attribute processing, batching and
     * export on top, all of which belong to whoever configures the exporter and
     * would swamp the part this repository can regress.
     */
    private static otelTracingCase(): TCNSBenchCase {
        return {
            id: 'observe/otel-tracing',
            operation: `the same ${CNSObservationBenchSuite.hops}-hop run with attachCNSOtelTracing attached (one span per activation, into a recording-only tracer)`,
            relativeTo: 'observe/none',
            prepare: () => {
                const graph = CNSBenchGraphFactory.linearChain(
                    CNSObservationBenchSuite.hops
                );
                const { tracer, spanCount } = CNSBenchTracerFactory.create();
                const handle = attachCNSOtelTracing(graph.cns as any, {
                    tracer,
                    neuronName: neuron =>
                        graph.registry.getNeuronName(neuron as any),
                    collateralName: collateral =>
                        graph.registry.getCollateralName(collateral as any),
                });
                const drive = () =>
                    graph.cns
                        .stimulate(graph.createEntrySignal(), {})
                        .waitUntilComplete();
                return {
                    run: drive,
                    verify: async () => {
                        const beforeActivations = graph.activationCount();
                        const beforeSpans = spanCount();
                        await drive();
                        CNSObservationBenchSuite.assertActivations(
                            graph,
                            beforeActivations
                        );
                        // One root plus one per activation. Asserted as a lower
                        // bound rather than an exact count so a change in how
                        // the tree is built fails loudly only when it stops
                        // producing spans at all.
                        const opened = spanCount() - beforeSpans;
                        if (opened < CNSObservationBenchSuite.hops) {
                            throw new Error(
                                `[bench] tracing opened ${opened} spans for ${CNSObservationBenchSuite.hops} activations — this case is not measuring tracing`
                            );
                        }
                    },
                    teardown: () => handle.detach(),
                };
            },
        };
    }

    private static assertActivations(
        graph: TCNSBenchGraph,
        before: number
    ): void {
        const fired = graph.activationCount() - before;
        if (fired !== graph.activationsPerStimulation) {
            throw new Error(
                `[bench] graph fired ${fired} dendrite bodies, expected ` +
                    `${graph.activationsPerStimulation} — the fixture is not measuring what it claims`
            );
        }
    }
}
