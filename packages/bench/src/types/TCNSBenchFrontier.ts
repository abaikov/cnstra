import type {
    CNSProgressSerializer,
    ICNSStimulation,
    TCNSProgress,
} from '../cnstra';
import type { TCNSBenchGraph } from './TCNSBenchGraph';

/**
 * A captured resume checkpoint: a real stalled run, the serializer bound to its
 * graph's registry, and the progress record already taken once.
 *
 * The pieces are what the round-trip benchmarks need at different points —
 * `stimulation` for `serialize`, `progressJson` for `hydrate`, and both for the
 * full checkpoint round trip.
 */
export type TCNSBenchFrontier = {
    graph: TCNSBenchGraph;
    serializer: CNSProgressSerializer;
    /** The stalled run whose outstanding frontier is being snapshotted. */
    stimulation: ICNSStimulation<any>;
    /** One snapshot, taken during setup, for cases that only hydrate. */
    progress: TCNSProgress;
    /**
     * The same snapshot after a `JSON.stringify`/`JSON.parse` pair — what
     * actually comes back out of a store, and therefore what `hydrate` is given
     * in production rather than the live object.
     */
    progressJson: TCNSProgress;
    /** How many tasks the frontier holds; a case's `verify` checks this. */
    taskCount: number;
};
