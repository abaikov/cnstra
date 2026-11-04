import { collateral } from '@cnstra/core';
import type { TCNSStimulationCommand } from '@cnstra/persist-dto';
import type { TCNSStimulationActionRefusalReason } from '../types/TCNSStimulationActionRefusalReason';

export const explorerActionAxon = {
    retryStarted: collateral<{ stimulationId: string }>(),
    retryAccepted: collateral<{ stimulationId: string }>(),
    retryRejected: collateral<{ stimulationId: string; error: string }>(),
    retryRefused: collateral<{ stimulationId: string; reason: TCNSStimulationActionRefusalReason }>(),
    cloneStarted: collateral<{ stimulationId: string }>(),
    cloneAccepted: collateral<{ stimulationId: string; cloneStimulationId: string }>(),
    cloneRejected: collateral<{ stimulationId: string; error: string }>(),
    cloneRefused: collateral<{ stimulationId: string; reason: TCNSStimulationActionRefusalReason }>(),
    commandStarted: collateral<{ stimulationId: string; command: TCNSStimulationCommand }>(),
    commandAccepted: collateral<{ stimulationId: string; command: TCNSStimulationCommand }>(),
    commandRejected: collateral<{ stimulationId: string; command: TCNSStimulationCommand; error: string }>(),
    commandRefused: collateral<{ stimulationId: string; command: TCNSStimulationCommand; reason: TCNSStimulationActionRefusalReason }>(),
    launchStarted: collateral<{ collateralName: string; payload: unknown }>(),
    launchAccepted: collateral<{ collateralName: string; stimulationId: string }>(),
    launchRejected: collateral<{ collateralName: string; error: string }>(),
    launchRefused: collateral<{ collateralName: string; reason: TCNSStimulationActionRefusalReason }>(),
};
