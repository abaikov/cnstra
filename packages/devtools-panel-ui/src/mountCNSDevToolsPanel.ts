import { CNSDevToolsPageConfig } from './transport/CNSDevToolsPageConfig';
import { mountCNSDevToolsPanelFromPageConfig } from './mountCNSDevToolsPanelFromPageConfig';
import type { TCNSDevToolsPanelMountFunction } from './types/TCNSDevToolsPanelMountFunction';

export const mountCNSDevToolsPanel: TCNSDevToolsPanelMountFunction = (element, options) =>
    mountCNSDevToolsPanelFromPageConfig(element, CNSDevToolsPageConfig.fromMountOptions(options));
