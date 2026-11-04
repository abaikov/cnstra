import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import type { TCNSDevToolsTransportHooks } from './TCNSDevToolsTransportHooks';

export type TCNSDevToolsTransportFactory = (hooks: TCNSDevToolsTransportHooks) => ICNSDevToolsTransport;
