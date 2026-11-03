import type { TCNSClientMessageDTO } from '@cnstra/devtools-dto';
import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import { mainCNS } from '../../cns';
import { wsAxon } from '../../cns/ws/WsAxon';
import { createPollingTransport } from './pollingTransport';
import { createDemoTransport } from './demoTransport';

// Framework-agnostic port of the old `useDevtoolsSocket` React hook: owns the
// DevTools <-> server connection (lifecycle, auto-reconnect) and forwards
// incoming frames into the CNS via `wsAxon`. Connection status is a bindable
// (was React state) so views derive UI from it.
//
// The connection itself is behind a transport seam. A WebSocket is the default
// and what almost every panel gets, but an upgrade does not survive every
// network (ingress with upgrades off, corporate proxy, a platform that cuts
// long-lived connections), and the server also speaks HTTP long-polling. Both
// carry the exact same protocol frames, so everything above this file — the
// request/reply clients, the CNS ingest — is written against strings, not
// against a socket.

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Which wire this panel is on. */
export type TCNSDevToolsTransportKind = 'socket' | 'polling' | 'demo';

/**
 * What a transport tells the controller. None of these ever fire synchronously
 * from the factory: the controller wires its `send` only once the factory has
 * returned, and the handshake in `onOpen` goes out through that.
 */
export type TCNSDevToolsTransportHooks = {
    /** Connection usable — the controller (re)sends the handshake here. */
    onOpen(): void;
    /**
     * Connection gone. `willRetry` says whether the transport is bringing it
     * back on its own, which is the difference between "connecting" and
     * "disconnected" in the header.
     */
    onClose(info: {
        code: number;
        reason?: string;
        willRetry: boolean;
    }): void;
    onError(info: { message: string }): void;
    /** One protocol frame, exactly as it came off the wire. */
    onMessage(data: string): void;
};

/**
 * A wire the DevTools protocol runs over: send a frame, and report frames back
 * through the hooks it was built with. Deliberately message-oriented — a
 * consumer that could reach the raw socket would only work on one of these.
 */
export interface ICNSDevtoolsTransport {
    /** Send one serialized frame. False when it cannot be delivered at all. */
    send(data: string): boolean;
    /** Stop for good: no reconnect, no further hooks. */
    dispose(): void;
}

export type TCNSDevToolsTransportFactory = (
    hooks: TCNSDevToolsTransportHooks
) => ICNSDevtoolsTransport;

const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Server-side switches the panel reads on connect. Absent flag ⇒ allowed. */
export type TCNSPanelUiConfig = {
    actions?: { retry?: boolean; clone?: boolean };
    /** How far back the Explorer looks on open, in ms. `0` ⇒ no window. */
    defaultWindowMs?: number;
};

export interface DevtoolsSocket {
    /** Reactive connection status (was React state). */
    connectionStatus: TExoWritableBindable<ConnectionStatus>;
    /**
     * What the server lets this panel offer, pushed once on connect.
     *
     * Empty until it arrives, and an absent flag means allowed — so an older
     * server that sends nothing leaves every action available.
     */
    uiConfig: TExoWritableBindable<TCNSPanelUiConfig>;
    /**
     * How this panel is actually talking to the server.
     *
     * Worth showing: the two behave differently under a flaky network, and
     * "connected" alone does not say whether you are on a live socket or on a
     * poll that can be seconds behind.
     */
    transport: TExoWritableBindable<TCNSDevToolsTransportKind>;
    /**
     * Listen to incoming protocol frames (raw strings, one per frame). Returns
     * the unsubscribe. This is the whole of what consumers get: correlating a
     * reply is their business, the wire underneath is not.
     */
    subscribe(listener: (data: string) => void): () => void;
    /** Safe, typed send. Returns false when the connection cannot take it. */
    send(message: TCNSClientMessageDTO): boolean;
    /** Tear down: stop reconnecting and close the connection. */
    dispose(): void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 2000;

/** Where the server is, as configured for the socket. */
const wsUrl = (): string =>
    (window as unknown as { __CNSTRA_DEVTOOLS_WS__?: string })
        .__CNSTRA_DEVTOOLS_WS__ || 'ws://localhost:8080';

/** The same server over plain HTTP — one source of truth for the address. */
export const httpUrlFromWsUrl = (url: string): string =>
    url.replace(/^ws/, 'http').replace(/\/+$/, '');

/**
 * Which transport this panel instance uses.
 *
 * The socket is the default and stays it; polling is an explicit opt-in for a
 * network that eats the upgrade. It is read from the page's query string —
 * `?transport=polling` — because that is where this panel already keeps its
 * per-instance state (see `queryState`), it survives the hash router and a
 * reload untouched, and it is a link you can hand to whoever is stuck behind
 * the same proxy.
 */
export const selectTransportKind = (): TCNSDevToolsTransportKind => {
    try {
        const requested = new URLSearchParams(window.location.search).get(
            'transport'
        );
        return requested === 'polling' || requested === 'demo' ? requested : 'socket';
    } catch {
        return 'socket';
    }
};

/** The default wire: one socket, reconnecting on its own until told to stop. */
export function createWebSocketTransport(
    hooks: TCNSDevToolsTransportHooks,
    url: string = wsUrl()
): ICNSDevtoolsTransport {
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = (): void => {
        if (disposed) return;
        ws = new WebSocket(url);

        ws.addEventListener('open', () => {
            reconnectAttempts = 0;
            hooks.onOpen();
        });

        ws.addEventListener('message', ev => {
            hooks.onMessage(
                typeof ev.data === 'string' ? ev.data : String(ev.data)
            );
        });

        ws.addEventListener('close', ev => {
            const willRetry =
                !disposed && reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
            hooks.onClose({
                code: ev.code,
                reason: ev.reason,
                willRetry,
            });
            if (!willRetry) return;
            reconnectTimer = setTimeout(() => {
                reconnectAttempts += 1;
                connect();
            }, RECONNECT_DELAY_MS);
        });

        ws.addEventListener('error', () => {
            hooks.onError({ message: 'ws error' });
        });
    };

    connect();

    return {
        send: (data: string): boolean => {
            try {
                if (!ws || ws.readyState !== WebSocket.OPEN) return false;
                ws.send(data);
                return true;
            } catch {
                return false;
            }
        },
        dispose: () => {
            disposed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            if (ws) {
                ws.close();
                ws = null;
            }
        },
    };
}

export function createDevtoolsSocket(): DevtoolsSocket {
    const listeners = new Set<(data: string) => void>();
    const connectionStatus = bindable<ConnectionStatus>('connecting');
    const uiConfig = bindable<TCNSPanelUiConfig>({});
    const kind = selectTransportKind();
    const transport = bindable<TCNSDevToolsTransportKind>(kind);

    let wire: ICNSDevtoolsTransport | null = null;

    const send = (message: TCNSClientMessageDTO): boolean => {
        if (!wire) return false;
        return wire.send(JSON.stringify(message));
    };

    const hooks: TCNSDevToolsTransportHooks = {
        onOpen: () => {
            connectionStatus.setValue('connected');

            // Identify as DevTools client, then request initial data.
            send({ type: 'client.connect' });
            send({ type: 'apps.query', requestId: genRequestId() });

            mainCNS.stimulate(wsAxon.open.createSignal());
        },
        onMessage: (data: string) => {
            // Read the config off the wire before handing the message on: it is
            // pushed without a requestId, so the request/reply client cannot see
            // it, and the buttons must know before the first run is drawn.
            try {
                const parsed = JSON.parse(data);
                if (parsed?.type === 'ui.config') {
                    uiConfig.setValue({
                        actions: parsed.actions,
                        defaultWindowMs: parsed.defaultWindowMs,
                    });
                }
            } catch {
                // Not JSON, or not ours — the CNS below decides what it is.
            }
            for (const listener of [...listeners]) listener(data);
            mainCNS.stimulate(wsAxon.message.createSignal(data));
        },
        onClose: info => {
            connectionStatus.setValue(
                info.willRetry ? 'connecting' : 'disconnected'
            );
            mainCNS.stimulate(
                wsAxon.close.createSignal({
                    code: info.code,
                    reason: info.reason,
                })
            );
        },
        onError: info => {
            connectionStatus.setValue('disconnected');
            mainCNS.stimulate(wsAxon.error.createSignal(info));
        },
    };

    wire =
        kind === 'polling'
            ? createPollingTransport({
                  url: httpUrlFromWsUrl(wsUrl()),
                  hooks,
              })
            : kind === 'demo'
              ? createDemoTransport(hooks)
              : createWebSocketTransport(hooks);

    return {
        connectionStatus,
        uiConfig,
        transport,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        send,
        dispose: () => {
            listeners.clear();
            wire?.dispose();
            wire = null;
        },
    };
}
