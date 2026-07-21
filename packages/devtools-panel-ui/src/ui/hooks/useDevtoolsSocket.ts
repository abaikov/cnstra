import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CNSDTOClientMessage } from '@cnstra/devtools-dto';
import { mainCNS } from '../../cns';
import { wsAxon } from '../../cns/ws/WsAxon';

// Generate an opaque requestId for the request/response query protocol.
const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface DevtoolsSocket {
    /** The live WebSocket ref, shared with child panels that talk to the server. */
    wsRef: React.MutableRefObject<WebSocket | null>;
    connectionStatus: ConnectionStatus;
    /** Safe, typed WebSocket send. Returns false when the socket is not open. */
    send: (message: CNSDTOClientMessage) => boolean;
}

/**
 * Owns the DevTools <-> server WebSocket: connection lifecycle, auto-reconnect,
 * and forwarding of incoming frames into the CNS via `wsAxon`.
 */
export const useDevtoolsSocket = (): DevtoolsSocket => {
    const wsRef = useRef<WebSocket | null>(null);
    const [connectionStatus, setConnectionStatus] =
        useState<ConnectionStatus>('connecting');

    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    const [reconnectTimer, setReconnectTimer] = useState<NodeJS.Timeout | null>(
        null
    );
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000; // 2 seconds

    // Safe WebSocket send with error handling.
    const send = useCallback((message: CNSDTOClientMessage): boolean => {
        try {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return false;
            }
            ws.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }, []);

    const connectToServer = useCallback(() => {
        const url =
            (window as any).__CNSTRA_DEVTOOLS_WS__ || 'ws://localhost:8080';
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener('open', () => {
            setConnectionStatus('connected');
            setReconnectAttempts(0); // Reset on successful connection

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
            setConnectionStatus('disconnected');
            mainCNS.stimulate(
                wsAxon.close.createSignal({ code: ev.code, reason: ev.reason })
            );

            // Attempt reconnection
            if (reconnectAttempts < maxReconnectAttempts) {
                setConnectionStatus('connecting');
                const timer = setTimeout(() => {
                    setReconnectAttempts(prev => prev + 1);
                    connectToServer();
                }, reconnectDelay);
                setReconnectTimer(timer);
            }
        });

        ws.addEventListener('error', () => {
            setConnectionStatus('disconnected');
            mainCNS.stimulate(
                wsAxon.error.createSignal({ message: 'ws error' })
            );
        });
    }, [reconnectAttempts, send]);

    useEffect(() => {
        connectToServer();

        return () => {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    return { wsRef, connectionStatus, send };
};
