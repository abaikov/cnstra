import { CNSBenchGraphFactory } from '../fixtures/CNSBenchGraphFactory';
import type { TCNSBenchCase } from '../types/TCNSBenchCase';
import type { TCNSBenchGraph } from '../types/TCNSBenchGraph';
import type { TCNSBenchSuite } from '../types/TCNSBenchSuite';

/**
 * The per-signal path — the thing CNStra sells and the thing that runs most.
 *
 * Every case here drives `cns.stimulate()` with NO listener of any kind, which
 * is not incidental: with no local `onResponse` and no global response listener,
 * `CNS.wrapOnResponse` returns `undefined` and the stimulation takes a
 * genuinely different route through the pump — it never builds a response
 * object per signal. That fast path is what an application without devtools
 * attached actually runs, so it gets measured on its own, and the cost of
 * leaving it is measured separately in the `observe` suite.
 *
 * Sizes are chosen to make the growth exponent readable rather than to look
 * impressive: 8 to 64, skipping the very small sizes where the fixed
 * per-stimulation cost dominates and would drag the fitted exponent below the
 * real one.
 */
export class CNSEngineBenchSuite {
    private static readonly chainSizes = [8, 16, 32, 64];
    private static readonly fanOutSizes = [8, 16, 32, 64];

    static create(): TCNSBenchSuite {
        return {
            name: 'engine',
            summary:
                'cns.stimulate() with nothing attached — the no-listener fast path',
            cases: [
                ...CNSEngineBenchSuite.chainSizes.map(hops =>
                    CNSEngineBenchSuite.syncChainCase(hops)
                ),
                ...CNSEngineBenchSuite.fanOutSizes.map(width =>
                    CNSEngineBenchSuite.fanOutCase(width)
                ),
                CNSEngineBenchSuite.asyncChainCase(8),
            ],
        };
    }

    /**
     * A synchronous chain runs to completion inside `stimulate()` itself — the
     * pump drains before the call returns — so the body deliberately does NOT
     * await anything. Awaiting would add a promise and a microtask turn per
     * operation to a path that has neither, and the resulting number would be
     * about promises rather than about the engine.
     */
    private static syncChainCase(hops: number): TCNSBenchCase {
        return {
            id: `engine/linear-chain-${hops}`,
            operation: `one cns.stimulate() through a ${hops}-neuron synchronous chain (${hops} dendrite bodies, ${hops} signals, no listener)`,
            scaling: { family: 'engine/linear-chain', n: hops },
            prepare: () => {
                const graph = CNSBenchGraphFactory.linearChain(hops);
                return {
                    run: () => {
                        graph.cns.stimulate(graph.createEntrySignal(), {});
                    },
                    verify: () =>
                        CNSEngineBenchSuite.verifySync(graph, () => {
                            graph.cns.stimulate(graph.createEntrySignal(), {});
                        }),
                };
            },
        };
    }

    /** One signal, `width` subscribers: dispatch and the activation queue, not chaining. */
    private static fanOutCase(width: number): TCNSBenchCase {
        return {
            id: `engine/fan-out-${width}`,
            operation: `one cns.stimulate() of a signal with ${width} subscriber neurons (${width} dendrite bodies from one signal, no listener)`,
            scaling: { family: 'engine/fan-out', n: width },
            prepare: () => {
                const graph = CNSBenchGraphFactory.fanOut(width);
                return {
                    run: () => {
                        graph.cns.stimulate(graph.createEntrySignal(), {});
                    },
                    verify: () =>
                        CNSEngineBenchSuite.verifySync(graph, () => {
                            graph.cns.stimulate(graph.createEntrySignal(), {});
                        }),
                };
            },
        };
    }

    /**
     * The same chain with handlers that return an already-resolved promise.
     *
     * The handlers do no work, on purpose. What is being priced is the engine's
     * asynchronous route — parking the activation, the microtask per hop,
     * resuming the pump — against the synchronous one, with nothing in between
     * to hide it. Read it next to `engine/linear-chain-8`: the difference is
     * what an `async` handler costs before it has done anything.
     */
    private static asyncChainCase(hops: number): TCNSBenchCase {
        return {
            id: `engine/linear-chain-async-${hops}`,
            operation: `one cns.stimulate() through a ${hops}-neuron chain of async handlers, awaited to completion (${hops} dendrite bodies, no listener)`,
            relativeTo: `engine/linear-chain-${hops}`,
            prepare: () => {
                const graph = CNSBenchGraphFactory.linearChain(hops, {
                    async: true,
                });
                const drive = async () => {
                    const stimulation = graph.cns.stimulate(
                        graph.createEntrySignal(),
                        {}
                    );
                    await stimulation.waitUntilComplete();
                };
                return {
                    run: drive,
                    verify: async () => {
                        const before = graph.activationCount();
                        await drive();
                        CNSEngineBenchSuite.assertActivations(graph, before);
                    },
                };
            },
        };
    }

    /**
     * Prove the graph still fires. A benchmark whose fixture silently stopped
     * doing work reports a spectacular improvement, which is the single most
     * expensive way for a performance suite to be wrong.
     */
    private static verifySync(graph: TCNSBenchGraph, once: () => void): void {
        const before = graph.activationCount();
        once();
        CNSEngineBenchSuite.assertActivations(graph, before);
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
