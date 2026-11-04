import type { TCNSDevToolsTransportHooks } from './TCNSDevToolsTransportHooks';
import type { TCNSPollingFetch } from './TCNSPollingFetch';

export type TCNSPollingTransportOptions = {
    url: string;
    hooks: TCNSDevToolsTransportHooks;
    sessionId?: string;
    backoffMs?: number;
    maxBackoffMs?: number;
    fetch?: TCNSPollingFetch;
};
