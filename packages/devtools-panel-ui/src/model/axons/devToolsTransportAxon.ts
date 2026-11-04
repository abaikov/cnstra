import { collateral } from '@cnstra/core';
import type { TCNSDevToolsConnectionStatus } from '../../types/TCNSDevToolsConnectionStatus';
import type { TCNSPanelUiConfig } from '../../types/TCNSPanelUiConfig';

export const devToolsTransportAxon = {
    connectionChanged: collateral<{ status: TCNSDevToolsConnectionStatus }>(),
    uiConfigReceived: collateral<{ uiConfig: TCNSPanelUiConfig }>(),
};
