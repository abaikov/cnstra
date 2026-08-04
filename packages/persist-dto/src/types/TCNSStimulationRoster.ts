import type { TCNSSignalJSON } from './TCNSSignalJSON';

/**
 * The stimulation-roster QUERY contract — the shapes a store returns when it can
 * push the retry-UI's filter / keyset-pagination / GROUP-BY down into itself
 * (SQL) instead of the caller deriving them in memory. See
 * `ICNSStimulationRosterQuery`. These are STORE-level query results; the devtools
 * server projects them onto its wire DTOs at the boundary.
 */

/** Filter over the roster (all fields ANDed; omitted = no constraint). */
export interface TCNSStimulationRosterFilter {
    scopeName?: string;
    status?: string;
    /** Entry (job-type) collateral name. */
    entryCollateralName?: string;
    /** Runs that activated this neuron (any task). */
    neuronName?: string;
    /** Substring match on stimulationId. */
    text?: string;
    /** startedAt window (ms). */
    since?: number;
    until?: number;
}

/**
 * One roster row = the run's identity + the envelope summaries derived from its
 * attempts (`startedAt` = MIN, `completedAt` = last, `hopCount` = SUM,
 * `hasError`). The resume `progress` the roster never needs is omitted.
 */
export interface TCNSStimulationRosterRow {
    stimulationId: string;
    scopeName?: string;
    entry: TCNSSignalJSON;
    status: string;
    startedAt: number;
    completedAt: number | null;
    hopCount: number;
    hasError: boolean;
}

/** One keyset page of roster rows. `nextCursor` is opaque; null = last page. */
export interface TCNSStimulationRosterPage {
    rows: TCNSStimulationRosterRow[];
    nextCursor: string | null;
    total: number;
}

export interface TCNSStimulationRosterCountBucket {
    name: string;
    count: number;
}

/** A throughput time-bucket: run counts by lifecycle state + optional metric sum. */
export interface TCNSStimulationRosterTimeBucket {
    tsBucket: number;
    completed: number;
    failed: number;
    running: number;
    /** Sum of the requested entry-payload metric over the bucket's runs. */
    metric?: number;
}

/** Aggregate counts over the filtered roster (the facet rail + Chart). */
export interface TCNSStimulationRosterFacets {
    byEntryCollateral: TCNSStimulationRosterCountBucket[];
    byStatus: { status: string; count: number }[];
    byNeuron: TCNSStimulationRosterCountBucket[];
    byTime: TCNSStimulationRosterTimeBucket[];
}
