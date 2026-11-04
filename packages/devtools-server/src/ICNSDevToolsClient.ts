import type { TCNSDevToolsClientRole } from './TCNSDevToolsClientRole';

export interface ICNSDevToolsClient {
    send(data: string): void;
    readonly readyState: number;
    readonly role?: TCNSDevToolsClientRole;
}
