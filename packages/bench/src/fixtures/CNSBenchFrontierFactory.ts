import { CNSProgressSerializer } from '../cnstra';
import type { TCNSBenchFrontier } from '../types/TCNSBenchFrontier';
import { CNSBenchGraphFactory } from './CNSBenchGraphFactory';

/**
 * Captures a real outstanding frontier of a known size.
 *
 * A frontier is the set of activations a run has not finished, and the honest
 * way to get one of a chosen size is to let a run stop with that many
 * activations unfinished. So: a fan-out of `width` neurons that all throw. The
 * engine records each as a failed task, failed tasks are part of the outstanding
 * frontier, and the run settles immediately instead of being held open by a
 * timer that the benchmark would then have to wait on.
 *
 * `registrySize` keeps the two variables apart. Each fan-out neuron brings its
 * own collateral into the registry, so varying `width` alone would vary the
 * frontier AND the registry together, and the resulting exponent would mix the
 * per-task serialization work with however the registry's name lookup scales —
 * an exponent near two would not say which half moved. Padding every case in a
 * family up to the largest width holds the lookup constant, leaving the frontier
 * as the only thing that changes.
 */
export class CNSBenchFrontierFactory {
    static async capture(
        width: number,
        registrySize?: number
    ): Promise<TCNSBenchFrontier> {
        const graph = CNSBenchGraphFactory.failingFanOut(width, registrySize);
        const stimulation = graph.cns.stimulate(graph.createEntrySignal());
        // Every activation throws, so the run rejects. That is the intended
        // outcome, not a failure of the fixture.
        await stimulation.waitUntilComplete().catch(() => undefined);

        const serializer = new CNSProgressSerializer(graph.registry);
        const progress = serializer.serialize(stimulation as any);
        const progressJson = JSON.parse(
            JSON.stringify(progress)
        ) as typeof progress;

        return {
            graph,
            serializer,
            stimulation: stimulation as any,
            progress,
            progressJson,
            taskCount: progress.tasks.length,
        };
    }
}
