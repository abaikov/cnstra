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
    TCNSServerMetrics,
} from '../../model';

/** A topology snapshot for one CNS of one app (from `app.connected` / `topology*`). */
export type TCNSTopologySnapshot = {
    cnsId: string;
    appId: string;
    neurons: TCNSNeuronDTO[];
    collaterals: TCNSCollateralDTO[];
    dendrites: TCNSDendriteDTO[];
};

/** Stimulation completion patch (from `stimulation.completed`). */
export type TCNSStimulationCompletion = {
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
    topologyReceived: collateral<TCNSTopologySnapshot>(),
    stimulationStarted: collateral<TCNSStimulationState>(),
    stimulationCompleted: collateral<TCNSStimulationCompletion>(),
    hopAdded: collateral<TCNSHopState>(),
    serverMetrics: collateral<TCNSServerMetrics>(),
    // UI action: user picked an app in the list.
    selectAppClicked: collateral<{ appId: string }>(),
};
