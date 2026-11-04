import type { TCNSDevToolsTransportKind } from './TCNSDevToolsTransportKind';

export type TCNSDevToolsPanelTransportKind = Exclude<TCNSDevToolsTransportKind, 'demo'>;
