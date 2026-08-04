import { collateral } from '@cnstra/core';
import type {
    TCNSAppDTO,
    TCNSCollateralDTO,
    TCNSDendriteDTO,
    TCNSNeuronDTO,
} from '@cnstra/devtools-dto';
import type {
    TCNSStimulationState,
    TCNSHopState,
    TServerMetrics,
} from '../../model';

/** A topology snapshot for one CNS of one app (from `app.connected` / `topology*`). */
export type TTopologySnapshot = {
    cnsId: string;
    appId: string;
    neurons: TCNSNeuronDTO[];
    collaterals: TCNSCollateralDTO[];
    dendrites: TCNSDendriteDTO[];
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
    appUpserted: collateral<TCNSAppDTO>(),
    appDisconnected: collateral<{ appId: string }>(),
    topologyReceived: collateral<TTopologySnapshot>(),
    stimulationStarted: collateral<TCNSStimulationState>(),
    stimulationCompleted: collateral<TStimulationCompletion>(),
    hopAdded: collateral<TCNSHopState>(),
    serverMetrics: collateral<TServerMetrics>(),
    // UI action: user picked an app in the list.
    selectAppClicked: collateral<{ appId: string }>(),
};
