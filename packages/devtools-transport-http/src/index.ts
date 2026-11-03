import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import {
    CNSAppCommandDTOSchema,
    type TCNSAppBatchMessageDTO,
    type TCNSAppCommandDTO,
} from '@cnstra/devtools-dto';

/**
 * The app side of the DevTools HTTP long-polling transport.
 *
 * A WebSocket is the default and stays the default. This is the fallback for a
 * network that will not carry an upgrade — an ingress with upgrades off, a proxy
 * that strips them, a platform that cuts long-lived connections. Nothing about
 * the protocol changes: the exact frames that would have gone over the socket go
 * over three plain HTTP verbs against one endpoint instead.
 *
 *   POST   <url>/__cnstra/poll?sessionId=…  — one protocol message, answered 204
 *   GET    <url>/__cnstra/poll?sessionId=…  — `{ messages: string[] }`; the server
 *                                             PARKS it (~25s) until it has something
 *   DELETE <url>/__cnstra/poll?sessionId=…  — drop the session
 *
 * Because the server parks the GET, the receive loop re-issues one immediately
 * after each answer rather than sleeping between polls — an idle app is one open
 * request, not a request loop. Silence is the only signal the server gets that a
 * polling participant is gone (it sweeps a session after ~60s), so the loop runs
 * for as long as the transport is alive.
 */

/** Cap on the retry delay, matching the panel's polling client. */
const MAX_BACKOFF_MS = 15_000;

const POLL_PATH = '/__cnstra/poll';

const sleep = (ms: number): Promise<void> =>
    new Promise<void>(resolve => setTimeout(resolve, ms));

export type TCNSDevToolsTransportHttpOptions = {
    /** DevTools server base URL, e.g. http://localhost:3141 */
    url: string;
    /**
     * `fetch` implementation. Defaults to the global one; pass it explicitly on a
     * runtime that has none (Node < 18) or to test without a network. Named the
     * way the ws transport names its `webSocketImpl`.
     */
    fetchImpl?: typeof fetch;
    /**
     * Session id for this transport instance — the key the server files the
     * app's mailbox under. Minted when not given; one per instance.
     */
    sessionId?: string;
    /**
     * Base delay before retrying after a FAILED request (default: 1000), doubled
     * per consecutive failure up to 15s. A successful poll is re-issued at once —
     * the parking happens server-side.
     */
    pollIntervalMs?: number;
    consoleLogEnabled?: boolean;
};

export class CNSDevToolsTransportHttp implements ICNSDevToolsTransport {
    /** The session this transport polls under. Stable for its whole life. */
    readonly sessionId: string;

    private closed = false;
    private receiving = false;
    private consecutiveFailures = 0;
    private readonly abortController = new AbortController();

    private readonly pendingBatches: TCNSAppBatchMessageDTO[] = [];
    private readonly commandHandlers = new Set<
        (cmd: TCNSAppCommandDTO) => void
    >();

    constructor(private readonly opts: TCNSDevToolsTransportHttpOptions) {
        this.sessionId = opts.sessionId ?? CNSDevToolsTransportHttp.mintSessionId();
    }

    // ─── ICNSDevToolsTransport ────────────────────────────────────────────────────

    async sendBatch(message: TCNSAppBatchMessageDTO): Promise<void> {
        this.pendingBatches.push(message);
        await this.flush();
        // Only once the app is actually talking to the server does it need to
        // listen: starting earlier would open a session for a transport that may
        // never be used.
        this.startReceiving();
    }

    onStimulationCommand(handler: (cmd: TCNSAppCommandDTO) => void): () => void {
        this.commandHandlers.add(handler);
        this.startReceiving();
        return () => {
            this.commandHandlers.delete(handler);
        };
    }

    // ─── Sending ──────────────────────────────────────────────────────────────────

    private async flush(): Promise<void> {
        // Reading the implementation before touching the queue: a missing `fetch`
        // is a configuration error and surfaces as such, the way the ws transport
        // surfaces a missing WebSocket.
        const doFetch = this.fetchOrThrow;

        const batches = this.pendingBatches.splice(0, this.pendingBatches.length);
        const items = batches.flatMap(b => b.items);
        if (items.length === 0) return;

        try {
            const response = await doFetch(this.endpoint(), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'batch', items }),
                signal: this.abortController.signal,
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            // The server may simply be restarting. Keep the items for the next
            // send; a transport failure must never take down the host app.
            this.pendingBatches.unshift(...batches);
            this.log('[DevTools] Batch send failed:', error);
        }
    }

    // ─── Receiving ────────────────────────────────────────────────────────────────

    /** Starts the receive loop once — on the first send or the first subscription. */
    private startReceiving(): void {
        if (this.receiving) return;
        this.receiving = true;
        void this.receiveLoop();
    }

    private async receiveLoop(): Promise<void> {
        while (!this.closed) {
            try {
                const response = await this.fetchOrThrow(this.endpoint(), {
                    method: 'GET',
                    signal: this.abortController.signal,
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const body = (await response.json()) as {
                    messages?: string[];
                };
                this.consecutiveFailures = 0;
                for (const raw of body.messages ?? []) {
                    try {
                        this.dispatch(raw);
                    } catch {
                        // A handler that threw is the app's problem: it must not
                        // read as a poll failure, nor cost the rest of the batch.
                    }
                }
            } catch (error) {
                if (this.closed) return;
                this.consecutiveFailures += 1;
                this.log('[DevTools] Poll failed, backing off:', error);
                await sleep(this.backoffMs());
            }
        }
    }

    private backoffMs(): number {
        const base = this.opts.pollIntervalMs ?? 1000;
        return Math.min(base * 2 ** (this.consecutiveFailures - 1), MAX_BACKOFF_MS);
    }

    /**
     * Commands arrive on the same poll as everything else, so each message is
     * routed by its `type` — and validated first, exactly as over the socket.
     */
    private dispatch(raw: string): void {
        let message: { type?: string } | null = null;
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }

        if (
            message?.type === 'cns.stimulation.resume' ||
            message?.type === 'cns.stimulation.launch'
        ) {
            const result = CNSAppCommandDTOSchema.safeParse(message);
            if (result.success) {
                this.commandHandlers.forEach(handler => handler(result.data));
            } else {
                this.log('[DevTools] Invalid stimulation command:', result.error.message);
            }
        }
    }

    // ─── Teardown ─────────────────────────────────────────────────────────────────

    /**
     * Stops the receive loop and drops the session server-side. Named `close` to
     * match the ws transport — the host app tears both down the same way.
     */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        // Frees the parked GET immediately instead of waiting out the server's park.
        this.abortController.abort();

        const doFetch = this.maybeFetch;
        if (!doFetch) return;
        // Best effort: without it the server sweeps the session on its own.
        void doFetch(this.endpoint(), { method: 'DELETE' }).catch(() => {});
    }

    // ─── Internals ────────────────────────────────────────────────────────────────

    /** The `fetch` this transport uses — absent only on a runtime without one. */
    private get maybeFetch(): typeof fetch | undefined {
        return this.opts.fetchImpl ?? globalThis.fetch;
    }

    private get fetchOrThrow(): typeof fetch {
        const impl = this.maybeFetch;
        if (!impl) {
            throw new Error('No fetch implementation. Pass fetchImpl option.');
        }
        return impl;
    }

    private endpoint(): string {
        const base = this.opts.url.replace(/\/+$/, '');
        return `${base}${POLL_PATH}?sessionId=${encodeURIComponent(this.sessionId)}`;
    }

    private log(message: string, detail: unknown): void {
        if (this.opts.consoleLogEnabled) console.warn(message, detail);
    }

    private static mintSessionId(): string {
        return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}
