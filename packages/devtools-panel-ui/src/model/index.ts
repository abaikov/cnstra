// Normalized DevTools domain models aligned with DTO types

import {
    OIMEventQueue,
    OIMEventQueueSchedulerMicrotask,
    OIMReactiveIndexManual,
    OIMRICollection,
} from '@oimdb/core';

// Import and re-export DTO types as our database model types
import type {
    DevToolsApp,
    DevToolsAppId,
    Neuron,
    NeuronId,
    Collateral,
    CollateralName,
    Dendrite,
    DendriteId,
    Stimulation,
    StimulationId,
    StimulationResponse,
    StimulationResponseId,
} from '@cnstra/devtools-dto';

export type TDevToolsApp = DevToolsApp;
export type TDevToolsAppId = DevToolsAppId;
export type TNeuron = Neuron;
// UI-extended neuron with denormalized metrics
export type UINeuron = TNeuron & { stimulationCount?: number };
export type TNeuronId = NeuronId;
export type TCollateral = Collateral;
export type TCollateralName = CollateralName;
export type TDendrite = Dendrite;
export type TDendriteId = DendriteId;
export type TStimulation = Stimulation;
export type TStimulationId = StimulationId;
export type TStimulationResponse = StimulationResponse;
export type TStimulationResponseId = StimulationResponseId;

// PK helper types for derived collections
export type TGraphLayoutPk = `${string}::${string}`;
export type TGraphEdgePk = `${string}::${string}->${string}::${string}`;

// Derived graph data stored separately to avoid duplicating base entities
export type TGraphLayout = {
    appId: TDevToolsAppId;
    neuronId: TNeuronId;
    x: number;
    y: number;
    stimulationCount: number;
};

export type TGraphEdge = {
    appId: TDevToolsAppId;
    from: TNeuronId;
    to: TNeuronId;
    label?: string;
    count: number; // aggregated stimulation count per edge
};

// CNS instance per app (supports many CNS per application)
export type TCns = {
    cnsId: string;
    appId: TDevToolsAppId;
};

// UI type to tolerate DTO migration (optional legacy fields)
export type UIStimulationResponse = Omit<
    TStimulationResponse,
    'appId' | 'neuronId'
> & {
    appId?: TDevToolsAppId;
    neuronId?: TNeuronId;
    inputCollateralName?: string;
    outputCollateralName?: string;
    hopIndex?: number;
    contexts?: Record<string, unknown>;
    inputPayload?: unknown;
    outputPayload?: unknown;
};

export const dbEventQueue = new OIMEventQueue({
    scheduler: new OIMEventQueueSchedulerMicrotask(),
});

// Database collections aligned with DTO field names
export const db = {
    apps: new OIMRICollection(dbEventQueue, {
        indexes: {
            all: new OIMReactiveIndexManual<'all', TDevToolsAppId>(
                dbEventQueue
            ),
            selected: new OIMReactiveIndexManual<'selected', TDevToolsAppId>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (app: TDevToolsApp) => app.appId,
        },
    }),
    neurons: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, TNeuronId>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (neuron: UINeuron) => neuron.id,
        },
    }),
    collaterals: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, TCollateralName>(
                dbEventQueue
            ),
            neuronId: new OIMReactiveIndexManual<TNeuronId, TCollateralName>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (collateral: TCollateral) => collateral.collateralName,
        },
    }),
    dendrites: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, TDendriteId>(
                dbEventQueue
            ),
            neuronId: new OIMReactiveIndexManual<TNeuronId, TDendriteId>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (dendrite: TDendrite) => dendrite.dendriteId,
        },
    }),
    cns: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, string>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (cns: TCns) => cns.cnsId,
        },
    }),
    stimulations: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, TStimulationId>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (stimulation: TStimulation) => stimulation.stimulationId,
        },
    }),
    responses: new OIMRICollection(dbEventQueue, {
        indexes: {
            stimulationId: new OIMReactiveIndexManual<
                TStimulationId,
                TStimulationResponseId
            >(dbEventQueue),
            appId: new OIMReactiveIndexManual<
                TDevToolsAppId,
                TStimulationResponseId
            >(dbEventQueue),
        },
        collectionOpts: {
            selectPk: (response: UIStimulationResponse) => response.responseId,
        },
    }),

    // Graph layouts per app and neuron
    graphLayouts: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, TGraphLayoutPk>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (layout: TGraphLayout) =>
                `${layout.appId}::${layout.neuronId}` as TGraphLayoutPk,
        },
    }),

    // Graph edges per app
    graphEdges: new OIMRICollection(dbEventQueue, {
        indexes: {
            appId: new OIMReactiveIndexManual<TDevToolsAppId, TGraphEdgePk>(
                dbEventQueue
            ),
        },
        collectionOpts: {
            selectPk: (edge: TGraphEdge) =>
                `${edge.appId}::${edge.from}->${edge.to}::${
                    edge.label || ''
                }` as TGraphEdgePk,
        },
    }),
};
