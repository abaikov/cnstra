import type { TCNSDevToolsConnectionStatus } from './TCNSDevToolsConnectionStatus';
import type { TCNSPanelUiConfig } from './TCNSPanelUiConfig';

export type TCNSDevToolsConnectionHooks = {
    onStatus(status: TCNSDevToolsConnectionStatus): void;
    onUiConfig(config: TCNSPanelUiConfig): void;
};
