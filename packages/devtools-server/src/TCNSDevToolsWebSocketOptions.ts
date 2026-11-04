import type { IncomingMessage } from 'http';

export type TCNSDevToolsWebSocketOptions = {
    authorizeUpgrade?: (request: IncomingMessage) => boolean | Promise<boolean>;
};
