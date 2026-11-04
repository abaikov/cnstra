import type { TCNSDevToolsConnectionStatus } from '../../types/TCNSDevToolsConnectionStatus';
import type { TCNSDevToolsTransportKind } from '../../types/TCNSDevToolsTransportKind';
import type { TCNSPanelUiConfig } from '../../types/TCNSPanelUiConfig';

export type TCNSDevToolsConnection = {
    status: TCNSDevToolsConnectionStatus;
    isOnline: boolean;
    isReadOnly: boolean;
    transportKind: TCNSDevToolsTransportKind;
    uiConfig: TCNSPanelUiConfig;
};
