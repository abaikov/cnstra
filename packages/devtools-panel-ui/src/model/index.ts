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
    createOIMCollectionKit,
    type OIMReactiveCollection,
    type TOIMPk,
} from '@oimdb/core';

import type {
    CNSDTOApp,
    CNSDTONeuron,
    CNSDTOCollateral,
    CNSDTODendrite,
    CNSDTOStimulation,
    CNSDTOHop,
} from '@cnstra/devtools-dto';

// ─── Domain types (aliases over the DTO — one source of truth) ────────────────

export type TApp = CNSDTOApp;
export type TAppId = string;
export type TNeuron = CNSDTONeuron;
export type TNeuronId = string;
/** UI-extended neuron with denormalized metrics for graph sizing. */
export type UINeuron = TNeuron & { stimulationCount?: number };
export type TCollateral = CNSDTOCollateral;
export type TCollateralId = string;
export type TDendrite = CNSDTODendrite;
export type TDendriteId = string;
export type TStimulation = CNSDTOStimulation;
export type TStimulationId = string;
export type THop = CNSDTOHop;
export type THopId = string;
/**
 * UI-extended hop: carries `appId` denormalized from its parent stimulation so
 * hops can be indexed by app without a stimulation join. Populated at ingest.
 */
export type UIHop = THop & { appId: TAppId };

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
    neuronId: TNeuronId;
    x: number;
    y: number;
    stimulationCount: number;
};

export type TGraphEdge = {
    appId: TAppId;
    from: TNeuronId;
    to: TNeuronId;
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
    TPk extends TOIMPk,
    TIndexes
> = OIMReactiveCollection<TEntity, TPk> & { indexes: TIndexes };

/**
 * Build a reactive collection and attach its indexes as `.indexes`, so consumers
 * (and the react hooks) keep the familiar `db.X` (collection) + `db.X.indexes.Y`
 * shape while the indexes stay auto-maintained.
 */
function collectionWith<
    TEntity extends object,
    TPk extends TOIMPk,
    TIndexes extends Record<string, unknown>
>(
    selectPk: (e: TEntity) => TPk,
    buildIndexes: (
        factory: ReturnType<
            typeof createOIMCollectionKit<TEntity, TPk>
        >['indexFactory']
    ) => TIndexes
): CollectionWithIndexes<TEntity, TPk, TIndexes> {
    const kit = createOIMCollectionKit<TEntity, TPk>(dbEventQueue, { selectPk });
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

    neurons: collectionWith<UINeuron, TNeuronId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<UINeuron, TNeuronId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        neuron => neuron.id,
        factory => ({ appId: factory.derivedSetIndex(n => [n.appId]) })
    ),

    collaterals: collectionWith<TCollateral, TCollateralId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCollateral, TCollateralId>>['indexFactory']['derivedSetIndex']
        >;
        neuronId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCollateral, TCollateralId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        collateral => collateral.id,
        factory => ({
            appId: factory.derivedSetIndex(c => [c.appId]),
            neuronId: factory.derivedSetIndex(c => [c.neuronId]),
        })
    ),

    dendrites: collectionWith<TDendrite, TDendriteId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TDendrite, TDendriteId>>['indexFactory']['derivedSetIndex']
        >;
        neuronId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TDendrite, TDendriteId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        dendrite => dendrite.id,
        factory => ({
            appId: factory.derivedSetIndex(d => [d.appId]),
            neuronId: factory.derivedSetIndex(d => [d.neuronId]),
        })
    ),

    cns: collectionWith<TCns, string, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TCns, string>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        cns => cns.cnsId,
        factory => ({ appId: factory.derivedSetIndex(c => [c.appId]) })
    ),

    stimulations: collectionWith<TStimulation, TStimulationId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<TStimulation, TStimulationId>>['indexFactory']['derivedSetIndex']
        >;
    }>(
        stimulation => stimulation.id,
        factory => ({ appId: factory.derivedSetIndex(s => [s.appId]) })
    ),

    // Hops (formerly "responses"): the per-neuron steps of a stimulation.
    responses: collectionWith<UIHop, THopId, {
        appId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<UIHop, THopId>>['indexFactory']['derivedSetIndex']
        >;
        stimulationId: ReturnType<
            ReturnType<typeof createOIMCollectionKit<UIHop, THopId>>['indexFactory']['derivedSetIndex']
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
