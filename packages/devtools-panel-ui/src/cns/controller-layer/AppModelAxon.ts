import { collateral } from '@cnstra/core';
import type {
    CNSDTOApp,
    CNSDTOCollateral,
    CNSDTODendrite,
    CNSDTONeuron,
    CNSDTOStimulation,
} from '@cnstra/devtools-dto';
import type { UIHop, TServerMetrics } from '../../model';

/** A topology snapshot for one CNS of one app (from `app.connected` / `topology*`). */
export type TTopologySnapshot = {
    cnsId: string;
    appId: string;
    neurons: CNSDTONeuron[];
    collaterals: CNSDTOCollateral[];
    dendrites: CNSDTODendrite[];
};

/** Stimulation completion patch (from `stimulation.completed`). */
export type TStimulationCompletion = {
    stimulationId: string;
    completedAt: number;
    hopCount: number;
    hasError: boolean;
};

/**
 * Domain events the ingress emits after parsing the server protocol. The
 * data-layer neurons persist them; indexes are derived, so persistence is a
 * plain upsert.
 */
export const appModelAxon = {
    appUpserted: collateral<CNSDTOApp>(),
    appDisconnected: collateral<{ appId: string }>(),
    topologyReceived: collateral<TTopologySnapshot>(),
    stimulationStarted: collateral<CNSDTOStimulation>(),
    stimulationCompleted: collateral<TStimulationCompletion>(),
    hopAdded: collateral<UIHop>(),
    serverMetrics: collateral<TServerMetrics>(),
    // UI action: user picked an app in the list.
    selectAppClicked: collateral<{ appId: string }>(),
};
