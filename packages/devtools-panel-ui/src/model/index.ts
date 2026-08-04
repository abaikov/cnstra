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

// ─── Domain types (aliases over the DTO — one source of truth) ────────────────

export type TApp = TCNSAppDTO;
export type TAppId = string;
export type TNeuron = TCNSNeuronDTO;
/** Composite pk `[cnsId, name]` — names are unique per cns (trie-backed). */
export type TNeuronPk = TOIMKeyPath;
/** The panel's stored neuron entity (currently 1:1 with the topology DTO — activity
 *  is derived on the fly, not stored, so there is no extra denormalized field). */
export type UINeuron = TNeuron;
export type TCollateral = TCNSCollateralDTO;
/** Composite pk `[cnsId, name]`. */
export type TCollateralPk = TOIMKeyPath;
export type TDendrite = TCNSDendriteDTO;
/** Composite pk `[cnsId, neuronName, collateralName]`. */
export type TDendritePk = TOIMKeyPath;
export type TStimulationId = string;
export type THopId = string;
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
    appId: TAppId;
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
    id: THopId;
    stimulationId: TStimulationId;
    attemptNumber: number;
    appId: TAppId;
    /** CNS scope (= cnsId) — used to resolve names→topology nodes at the graph boundary. */
    scopeName: string;
    /** Always set at ingest (falls back to the stimulation's start) — narrows the
     *  optional `startedAt` of the base task so cleanup/sorting stays total. */
    startedAt: number;
};

// A CNS instance is not a DTO entity; the panel synthesizes one per (appId, cnsId)
// from topology messages (an app can host several CNS).
export type TCns = { cnsId: string; appId: TAppId };

export type TServerMetrics = {
    timestamp: number;
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    cpuPercent: number;
};

// ─── Derived graph data (panel-local, computed from base entities) ────────────

export type TGraphLayoutPk = `${string}::${string}`;
export type TGraphEdgePk = `${string}::${string}->${string}::${string}`;

export type TGraphLayout = {
    appId: TAppId;
    /** Graph node key `${cnsId}:${name}`, built at render — not a stored id. */
    neuronId: string;
    x: number;
    y: number;
    stimulationCount: number;
};

export type TGraphEdge = {
    appId: TAppId;
    /** Graph node keys `${cnsId}:${name}`. */
    from: string;
    to: string;
    label?: string;
    count: number;
};

// UI state for response/hop collapsible blocks.
export type TResponseUIState = {
    responseId: THopId;
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
    apps: collectionWith<TApp, TAppId, {
        all: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TApp, TAppId>>['indexFactory']['derivedSetIndex']
        >;
        selected: OIMReactiveIndexManualSetBased<'selected', TAppId>;
    }>(
        app => app.id,
        factory => ({
            all: factory.derivedSetIndex(() => ['all']),
            selected: new OIMReactiveIndexManualSetBased<'selected', TAppId>(
                dbEventQueue
            ),
        })
    ),

    neurons: collectionWith<UINeuron, TNeuronPk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<UINeuron, TNeuronPk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        neuron => [neuron.cnsId, neuron.name] as TNeuronPk,
        factory => ({ appId: factory.derivedSetIndex(n => [n.appId]) }),
        new OIMCollectionStoreTrieDriven<UINeuron>()
    ),

    collaterals: collectionWith<TCollateral, TCollateralPk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCollateral, TCollateralPk>>['indexFactory']['derivedSetIndex']
        >;
        ownerNeuronName: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCollateral, TCollateralPk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        collateral => [collateral.cnsId, collateral.name] as TCollateralPk,
        factory => ({
            appId: factory.derivedSetIndex(c => [c.appId]),
            // Entry collaterals (no owner) are simply absent from this index.
            ownerNeuronName: factory.derivedSetIndex(c =>
                c.ownerNeuronName ? [c.ownerNeuronName] : []
            ),
        }),
        new OIMCollectionStoreTrieDriven<TCollateral>()
    ),

    dendrites: collectionWith<TDendrite, TDendritePk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TDendrite, TDendritePk>>['indexFactory']['derivedSetIndex']
        >;
        neuronName: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TDendrite, TDendritePk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        dendrite => [dendrite.cnsId, dendrite.neuronName, dendrite.collateralName] as TDendritePk,
        factory => ({
            appId: factory.derivedSetIndex(d => [d.appId]),
            neuronName: factory.derivedSetIndex(d => [d.neuronName]),
        }),
        new OIMCollectionStoreTrieDriven<TDendrite>()
    ),

    cns: collectionWith<TCns, string, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCns, string>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        cns => cns.cnsId,
        factory => ({ appId: factory.derivedSetIndex(c => [c.appId]) })
    ),

    stimulations: collectionWith<TCNSStimulationState, TStimulationId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSStimulationState, TStimulationId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        stimulation => stimulation.stimulationId,
        factory => ({ appId: factory.derivedSetIndex(s => [s.appId]) })
    ),

    // Hops (formerly "responses"): the per-neuron steps of a stimulation.
    responses: collectionWith<TCNSHopState, THopId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSHopState, THopId>>['indexFactory']['derivedSetIndex']
        >;
        stimulationId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCNSHopState, THopId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        hop => hop.id,
        factory => ({
            appId: factory.derivedSetIndex(h => [h.appId]),
            stimulationId: factory.derivedSetIndex(h => [h.stimulationId]),
        })
    ),

    graphLayouts: collectionWith<TGraphLayout, TGraphLayoutPk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TGraphLayout, TGraphLayoutPk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        layout => `${layout.appId}::${layout.neuronId}` as TGraphLayoutPk,
        factory => ({ appId: factory.derivedSetIndex(l => [l.appId]) })
    ),

    graphEdges: collectionWith<TGraphEdge, TGraphEdgePk, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TGraphEdge, TGraphEdgePk>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        edge =>
            `${edge.appId}::${edge.from}->${edge.to}::${
                edge.label || ''
            }` as TGraphEdgePk,
        factory => ({ appId: factory.derivedSetIndex(e => [e.appId]) })
    ),

    serverMetrics: collectionWith<TServerMetrics, `${number}`, {
        all: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TServerMetrics, `${number}`>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        metrics => `${metrics.timestamp}` as `${number}`,
        factory => ({ all: factory.derivedSetIndex(() => ['all']) })
    ),

    responseUIState: collectionWith<TResponseUIState, THopId, Record<string, never>>(
        state => state.responseId,
        () => ({})
    ),
};
