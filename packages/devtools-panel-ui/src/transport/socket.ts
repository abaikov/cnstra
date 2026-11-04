import { CNSUiConfigDTOSchema } from '@cnstra/devtools-dto';
import type { TCNSClientMessageDTO } from '@cnstra/devtools-dto';
import type { ICNSDevToolsSocket } from '../interfaces/ICNSDevToolsSocket';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import type { TCNSDevToolsConnectionHooks } from '../types/TCNSDevToolsConnectionHooks';
import type { TCNSDevToolsTransportHooks } from '../types/TCNSDevToolsTransportHooks';
import type { TCNSDevToolsPageConfig } from '../types/TCNSDevToolsPageConfig';
import type { TCNSDevToolsTransportFactory } from '../types/TCNSDevToolsTransportFactory';
import { createCNSPollingTransport } from './pollingTransport';

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 2000;

function createWebSocketTransport(hooks: TCNSDevToolsTransportHooks, url: string): ICNSDevToolsTransport {
    let webSocket: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = (): void => {
        if (disposed) return;
        webSocket = new WebSocket(url);

        webSocket.addEventListener('open', () => {
            if (disposed) return;
            reconnectAttempts = 0;
            hooks.onOpen();
        });

        webSocket.addEventListener('message', event => {
            if (disposed) return;
            hooks.onMessage(typeof event.data === 'string' ? event.data : String(event.data));
        });

        webSocket.addEventListener('close', event => {
            if (disposed) return;
            const willRetry = reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
            hooks.onClose({ code: event.code, reason: event.reason, willRetry });
            if (!willRetry) return;
            reconnectTimer = setTimeout(() => {
                reconnectAttempts += 1;
                connect();
            }, RECONNECT_DELAY_MS);
        });

        webSocket.addEventListener('error', () => {
            if (disposed) return;
            hooks.onError({ message: 'ws error' });
        });
    };

    connect();

    return {
        send: (data: string): boolean => {
            try {
                if (!webSocket || webSocket.readyState !== WebSocket.OPEN) return false;
                webSocket.send(data);
                return true;
            } catch {
                return false;
            }
        },
        dispose: () => {
            disposed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            if (webSocket) {
                webSocket.close();
                webSocket = null;
            }
        },
    };
}

const isUiConfigFrame = (frame: unknown): boolean =>
    typeof frame === 'object' && frame !== null && 'type' in frame && frame.type === 'ui.config';

export function createCNSDevToolsSocket(pageConfig: TCNSDevToolsPageConfig, createDemoTransport?: TCNSDevToolsTransportFactory): ICNSDevToolsSocket {
    const listeners = new Set<(data: string) => void>();
    const { transportKind } = pageConfig;

    let wire: ICNSDevToolsTransport | null = null;

    const send = (message: TCNSClientMessageDTO): boolean => {
        if (!wire) return false;
        return wire.send(JSON.stringify(message));
    };

    const hooksOf = (connectionHooks: TCNSDevToolsConnectionHooks): TCNSDevToolsTransportHooks => ({
        onOpen: () => {
            connectionHooks.onStatus('connected');
            send({ type: 'client.connect' });
        },
        onMessage: (data: string) => {
            let frame: unknown;
            try {
                frame = JSON.parse(data);
            } catch {
                return;
            }
            if (isUiConfigFrame(frame)) {
                const uiConfig = CNSUiConfigDTOSchema.safeParse(frame);
                if (uiConfig.success) connectionHooks.onUiConfig({ actions: uiConfig.data.actions, defaultWindowMs: uiConfig.data.defaultWindowMs });
            }
            for (const listener of [...listeners]) listener(data);
        },
        onClose: info => connectionHooks.onStatus(info.willRetry ? 'connecting' : 'disconnected'),
        onError: () => connectionHooks.onStatus('disconnected'),
    });

    return {
        transportKind,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        send,
        connect: connectionHooks => {
            const hooks = hooksOf(connectionHooks);
            if (transportKind === 'demo' && createDemoTransport === undefined) {
                hooks.onError({ message: 'the demo transport is not available in this build' });
                return;
            }
            wire =
                transportKind === 'polling'
                    ? createCNSPollingTransport({ url: pageConfig.httpUrl, hooks })
                    : transportKind === 'demo' && createDemoTransport !== undefined
                      ? createDemoTransport(hooks)
                      : createWebSocketTransport(hooks, pageConfig.socketUrl);
        },
        dispose: () => {
            listeners.clear();
            wire?.dispose();
            wire = null;
        },
    };
}
