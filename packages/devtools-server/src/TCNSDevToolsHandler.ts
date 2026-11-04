import type { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';

export type TCNSDevToolsHandler = {
    node(request: IncomingMessage, response: ServerResponse, next?: (error?: unknown) => void): Promise<void>;
    fetch(request: Request): Promise<Response>;
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean>;
    ready(): Promise<void>;
    dispose(): Promise<void>;
};
