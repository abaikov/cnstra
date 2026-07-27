import type { CNSDTOClientMessage } from '@cnstra/devtools-dto';
import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import { mainCNS } from '../../cns';
import { wsAxon } from '../../cns/ws/WsAxon';

// Framework-agnostic port of the old `useDevtoolsSocket` React hook: owns the
// DevTools <-> server WebSocket (connection lifecycle, auto-reconnect) and
// forwards incoming frames into the CNS via `wsAxon`. Connection status is a
// bindable (was React state) so views derive UI from it.

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface DevtoolsSocket {
    /** Reactive connection status (was React state). */
    connectionStatus: TExoWritableBindable<ConnectionStatus>;
    /**
     * Stable ref whose `.current` always points at the live socket (updated on
     * every reconnect). Islands that attach their own `message` listeners read it.
     */
    wsRef: { current: WebSocket | null };
    /** Current live socket, or null when not open. */
    getSocket(): WebSocket | null;
    /** Safe, typed send. Returns false when the socket is not open. */
    send(message: CNSDTOClientMessage): boolean;
    /** Tear down: stop reconnecting and close the socket. */
    dispose(): void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 2000;

export function createDevtoolsSocket(): DevtoolsSocket {
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const wsRef: { current: WebSocket | null } = { current: null };
    const connectionStatus = bindable<ConnectionStatus>('connecting');

    const send = (message: CNSDTOClientMessage): boolean => {
        try {
            if (!ws || ws.readyState !== WebSocket.OPEN) return false;
            ws.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    };

    const connect = (): void => {
        if (disposed) return;
        const url =
            (window as unknown as { __CNSTRA_DEVTOOLS_WS__?: string })
                .__CNSTRA_DEVTOOLS_WS__ || 'ws://localhost:8080';
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener('open', () => {
            connectionStatus.setValue('connected');
            reconnectAttempts = 0;

            // Identify as DevTools client, then request initial data.
            send({ type: 'client.connect' });
            send({ type: 'apps.query', requestId: genRequestId() });
            send({ type: 'topology.query', requestId: genRequestId() });

            mainCNS.stimulate(wsAxon.open.createSignal());
        });

        ws.addEventListener('message', ev => {
            mainCNS.stimulate(wsAxon.message.createSignal(ev.data));
        });

        ws.addEventListener('close', ev => {
            connectionStatus.setValue('disconnected');
            mainCNS.stimulate(
                wsAxon.close.createSignal({ code: ev.code, reason: ev.reason })
            );
            if (disposed) return;
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                connectionStatus.setValue('connecting');
                reconnectTimer = setTimeout(() => {
                    reconnectAttempts += 1;
                    connect();
                }, RECONNECT_DELAY_MS);
            }
        });

        ws.addEventListener('error', () => {
            connectionStatus.setValue('disconnected');
            mainCNS.stimulate(wsAxon.error.createSignal({ message: 'ws error' }));
        });
    };

    connect();

    return {
        connectionStatus,
        wsRef,
        getSocket: () => ws,
        send,
        dispose: () => {
            disposed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            if (ws) {
                ws.close();
                ws = null;
            }
            wsRef.current = null;
        },
    };
}
