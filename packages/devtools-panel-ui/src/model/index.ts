// Normalized DevTools domain model, aligned 1:1 with @cnstra/devtools-dto.
//
// Storage is OIMDB 3.x: each `db.<entity>` is an OIMReactiveCollection with its
// reactive indexes attached as `.indexes`. Indexes are *derived* (auto-maintained
// from entity fields) except `apps.selected`, which is UI selection state and so
// is a manual set index a controller writes.

import {
    OIMEventQueue,
    OIMEventQueueSchedulerMicrotask,
    OIMReactiveIndexManualSetBased,
    OIMCollectionStoreTrieDriven,
    createOIMCollectionKit,
    type OIMReactiveCollection,
    type OIMCollectionStore,
    type TOIMPk,
    type TOIMKey,
    type TOIMKeyPath,
} from '@oimdb/core';

import type {
    TCNSAppDTO,
    TCNSNeuronDTO,
    TCNSCollateralDTO,
    TCNSDendriteDTO,
    TCNSStimulationViewDTO,
    TCNSStimulationTaskViewDTO,
} from '@cnstra/devtools-dto';

// ─── Domain types ─────────────────────────────────────────────────────────────
// Topology entities ARE the wire DTOs verbatim — re-exported so panel code imports
// them from one place. The panel adds only composite-pk aliases + derived types.
export type {
    TCNSAppDTO,
    TCNSNeuronDTO,
    TCNSCollateralDTO,
    TCNSDendriteDTO,
} from '@cnstra/devtools-dto';

export type TCNSAppId = string;
/** Composite pk `[cnsId, name]` — names are unique per cns (trie-backed). */
export type TCNSNeuronPk = TOIMKeyPath;
/** Composite pk `[cnsId, name]`. */
export type TCNSCollateralPk = TOIMKeyPath;
/** Composite pk `[cnsId, neuronName, collateralName]`. */
export type TCNSDendritePk = TOIMKeyPath;
export type TCNSStimulationId = string;
export type TCNSHopId = string;
/**
 * The panel's stored stimulation row — INHERITED from the backend observability
 * view (`TCNSStimulationViewDTO`, by name) via `Omit`, minus the nested attempts
 * (whose tasks live flat in `db.responses`, stored exactly once). Adds a required
 * `scopeName` (= cnsId), a denormalized `appId` (so stimulations index by app),
 * and `startedAt/completedAt/hopCount/hasError` summary counters aggregated at
 * ingest (avoid re-scanning hops every render). No id is synthesized from names —
 * `entry` stays the shared `TCNSSignalJSON` leaf.
 */
export type TCNSStimulationState = Omit<
    TCNSStimulationViewDTO,
    'attempts' | 'scopeName'
> & {
    scopeName: string;
    appId: TCNSAppId;
    startedAt: number;
    completedAt: number | null;
    hopCount: number;
    hasError: boolean;
};
/**
 * The panel's stored hop row — one backend task (`TCNSStimulationTaskViewDTO`, by
 * name) plus denormalized keys for indexing and the graph-boundary name→node
 * resolution. `id` is a surrogate row key `${stimulationId}#${attemptNumber}:${index}`
 * (composed from real ids/indices, NOT derived from any name).
 */
export type TCNSHopState = TCNSStimulationTaskViewDTO & {
    id: TCNSHopId;
    stimulationId: TCNSStimulationId;
    attemptNumber: number;
    appId: TCNSAppId;
    /** CNS scope (= cnsId) — used to resolve names→topology nodes at the graph boundary. */
    scopeName: string;
    /** Always set at ingest (falls back to the stimulation's start) — narrows the
     *  optional `startedAt` of the base task so cleanup/sorting stays total. */
    startedAt: number;
};

// The identity of a CNS instance — which cns, in which app. Not a DTO entity; the
// panel synthesizes one per (appId, cnsId) from topology messages (an app can host
// several CNS).
export type TCNSIdentity = { cnsId: string; appId: TCNSAppId };

export type TCNSServerMetrics = {
    timestamp: number;
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    cpuPercent: number;
};

// ─── Derived graph data (panel-local, computed from base entities) ────────────

export type TCNSGraphLayoutPk = `${string}::${string}`;
export type TCNSGraphEdgePk = `${string}::${string}->${string}::${string}`;

export type TCNSGraphLayout = {
    appId: TCNSAppId;
    /** Graph node key `${cnsId}:${name}`, built at render — not a stored id. */
    neuronId: string;
    x: number;
    y: number;
    stimulationCount: number;
};

export type TCNSGraphEdge = {
    appId: TCNSAppId;
    /** Graph node keys `${cnsId}:${name}`. */
    from: string;
    to: string;
    label?: string;
    count: number;
};

// UI state for response/hop collapsible blocks.
export type TCNSResponseUIState = {
    responseId: TCNSHopId;
    isExpanded: boolean;
};

// ─── Event queue ──────────────────────────────────────────────────────────────

export const dbEventQueue = new OIMEventQueue({
    scheduler: new OIMEventQueueSchedulerMicrotask(),
});

// ─── Collection helper ────────────────────────────────────────────────────────

type CollectionWithIndexes<
    TEntity extends object,
    TPk extends TOIMKey,
    TIndexes
> = OIMReactiveCollection<TEntity, TPk> & { indexes: TIndexes };

/**
 * Build a reactive collection and attach its indexes as `.indexes`, so consumers
 * (and the react hooks) keep the familiar `db.X` (collection) + `db.X.indexes.Y`
 * shape while the indexes stay auto-maintained.
 */
function collectionWith<
    TEntity extends object,
    TPk extends TOIMKey,
    TIndexes extends Record<string, unknown>
>(
    selectPk: (e: TEntity) => TPk,
    buildIndexes: (
        factory: ReturnType<
            typeof createOIMCollectionKit<TEntity, TPk>
        >['indexFactory']
    ) => TIndexes,
    store?: OIMCollectionStore<TEntity, TPk>
): CollectionWithIndexes<TEntity, TPk, TIndexes> {
    const kit = createOIMCollectionKit<TEntity, TPk>(dbEventQueue, {
        selectPk,
        store,
    });
    const indexes = buildIndexes(kit.indexFactory);
    return Object.assign(kit.collection, { indexes });
}

// ─── Collections ──────────────────────────────────────────────────────────────

export const db = {
    apps: collectionWith<TCNSAppDTO, TCNSAppId, {
        all: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSAppDTO, TCNSAppId>>['indexFactory']['derivedSetIndex']
        >;
        selected: OIMReactiveIndexManualSetBased<'selected', TCNSAppId>;
    }>(
        app => app.id,
        factory => ({
            all: factory.derivedSetIndex(() => ['all']),
            selected: new OIMReactiveIndexManualSetBased<'selected', TCNSAppId>(
                dbEventQueue
            ),
        })
    ),

    neurons: collectionWith<TCNSNeuronDTO, TCNSNeuronPk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSNeuronDTO, TCNSNeuronPk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        neuron => [neuron.cnsId, neuron.name] as TCNSNeuronPk,
        factory => ({ appId: factory.derivedSetIndex(n => [n.appId]) }),
        new OIMCollectionStoreTrieDriven<TCNSNeuronDTO>()
    ),

    collaterals: collectionWith<TCNSCollateralDTO, TCNSCollateralPk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSCollateralDTO, TCNSCollateralPk>>['indexFactory']['derivedSetIndex']
        >;
        ownerNeuronName: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSCollateralDTO, TCNSCollateralPk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        collateral => [collateral.cnsId, collateral.name] as TCNSCollateralPk,
        factory => ({
            appId: factory.derivedSetIndex(c => [c.appId]),
            // Entry collaterals (no owner) are simply absent from this index.
            ownerNeuronName: factory.derivedSetIndex(c =>
                c.ownerNeuronName ? [c.ownerNeuronName] : []
            ),
        }),
        new OIMCollectionStoreTrieDriven<TCNSCollateralDTO>()
    ),

    dendrites: collectionWith<TCNSDendriteDTO, TCNSDendritePk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSDendriteDTO, TCNSDendritePk>>['indexFactory']['derivedSetIndex']
        >;
        neuronName: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSDendriteDTO, TCNSDendritePk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        dendrite => [dendrite.cnsId, dendrite.neuronName, dendrite.collateralName] as TCNSDendritePk,
        factory => ({
            appId: factory.derivedSetIndex(d => [d.appId]),
            neuronName: factory.derivedSetIndex(d => [d.neuronName]),
        }),
        new OIMCollectionStoreTrieDriven<TCNSDendriteDTO>()
    ),

    cns: collectionWith<TCNSIdentity, string, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSIdentity, string>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        cns => cns.cnsId,
        factory => ({ appId: factory.derivedSetIndex(c => [c.appId]) })
    ),

    stimulations: collectionWith<TCNSStimulationState, TCNSStimulationId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSStimulationState, TCNSStimulationId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        stimulation => stimulation.stimulationId,
        factory => ({ appId: factory.derivedSetIndex(s => [s.appId]) })
    ),

    // Hops (formerly "responses"): the per-neuron steps of a stimulation.
    responses: collectionWith<TCNSHopState, TCNSHopId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSHopState, TCNSHopId>>['indexFactory']['derivedSetIndex']
        >;
        stimulationId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSHopState, TCNSHopId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        hop => hop.id,
        factory => ({
            appId: factory.derivedSetIndex(h => [h.appId]),
            stimulationId: factory.derivedSetIndex(h => [h.stimulationId]),
        })
    ),

    graphLayouts: collectionWith<TCNSGraphLayout, TCNSGraphLayoutPk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSGraphLayout, TCNSGraphLayoutPk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        layout => `${layout.appId}::${layout.neuronId}` as TCNSGraphLayoutPk,
        factory => ({ appId: factory.derivedSetIndex(l => [l.appId]) })
    ),

    graphEdges: collectionWith<TCNSGraphEdge, TCNSGraphEdgePk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSGraphEdge, TCNSGraphEdgePk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        edge =>
            `${edge.appId}::${edge.from}->${edge.to}::${
                edge.label || ''
            }` as TCNSGraphEdgePk,
        factory => ({ appId: factory.derivedSetIndex(e => [e.appId]) })
    ),

    serverMetrics: collectionWith<TCNSServerMetrics, `${number}`, {
        all: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSServerMetrics, `${number}`>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        metrics => `${metrics.timestamp}` as `${number}`,
        factory => ({ all: factory.derivedSetIndex(() => ['all']) })
    ),

    responseUIState: collectionWith<TCNSResponseUIState, TCNSHopId, Record<string, never>>(
        state => state.responseId,
        () => ({})
    ),
};
