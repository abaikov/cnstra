import type {
    CNS,
    CNSPersistOptionsRegistry,
    ICNSCollateral,
    TCNSSignal,
    TCNSSignalJSON,
} from '../cnstra';
import type { TCNSBenchPayload } from './TCNSBenchPayload';

/**
 * A built graph plus everything a benchmark needs to drive it and to persist it:
 * the CNS, the collateral a run enters through, and the name registry that the
 * persist layer resolves neurons and collaterals against.
 *
 * `activationCount` is what a case's `verify` checks. Without it a graph that
 * quietly stopped firing — a mis-wired dendrite, a collateral registered twice —
 * would read as an enormous speed-up rather than as a broken fixture.
 */
export type TCNSBenchGraph = {
    cns: CNS<any, any>;
    entryCollateral: ICNSCollateral<TCNSBenchPayload>;
    /** The name `entryCollateral` is registered under; the persistor needs it. */
    entryCollateralName: string;
    registry: CNSPersistOptionsRegistry;
    /** The entry signal set, as the persistor's `entry` option wants it. */
    entryJSON: TCNSSignalJSON[];
    /** A fresh entry signal, always with the same payload object. */
    createEntrySignal: () => TCNSSignal<ICNSCollateral<TCNSBenchPayload>>;
    /** Dendrite bodies executed since the graph was built. */
    activationCount: () => number;
    /** Dendrite bodies exactly one stimulation of this graph should execute. */
    activationsPerStimulation: number;
};
