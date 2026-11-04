import { collateral } from '@cnstra/core';
import type { TCNSDevToolsConnectionStatus } from '../../types/TCNSDevToolsConnectionStatus';
import type { TCNSPanelUiConfig } from '../../types/TCNSPanelUiConfig';

export const connectionAxon = {
    connectionStatusChanged: collateral<{ status: TCNSDevToolsConnectionStatus }>(),
    uiConfigApplied: collateral<{ uiConfig: TCNSPanelUiConfig }>(),
};
