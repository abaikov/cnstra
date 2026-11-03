import type { CNSDevToolsServer } from './index';

/**
 * An HTTP long-polling transport for the DevTools protocol.
 *
 * A WebSocket is the right connection for this — it is what the panel and the
 * apps use by default. But an upgrade does not always survive the trip: an
 * ingress with upgrades off, a corporate proxy, a platform that cuts long-lived
 * connections. Polling is the fallback for exactly those, and nothing else about
 * the protocol changes.
 *
 * The server's own logic is already transport-agnostic — `handleMessage` takes
 * anything with `send(data: string)` — so a polling participant is represented by
 * one of those with a mailbox behind it: messages the server "sends" are queued,
 * and a `GET` drains them.
 */

/** How the protocol reaches a participant that cannot hold a socket open. */
export interface ICNSPollingSession {
    /** The socket-shaped object handed to `handleMessage` / `removeClient`. */
    readonly client: { send(data: string): void; readyState: number };
    /** Messages queued since the last drain. */
    take(): string[];
    /** Park until a message arrives or the wait elapses; then drain. */
    wait(timeoutMs: number): Promise<string[]>;
    /** Last time this session was seen, for expiry. */
    lastSeenAt: number;
}

const createSession = (): ICNSPollingSession => {
    let queued: string[] = [];
    let wake: (() => void) | undefined;

    const session: ICNSPollingSession = {
        client: {
            // `readyState` 1 is what `liveSockets` checks before routing an action
            // to a participant: a polling session is reachable as long as it has
            // not expired, and expiry removes it outright.
            readyState: 1,
            send(data: string) {
                queued.push(data);
                wake?.();
            },
        },
        take() {
            const out = queued;
            queued = [];
            return out;
        },
        async wait(timeoutMs: number) {
            if (queued.length) return session.take();

            await new Promise<void>(resolve => {
                const timer = setTimeout(() => {
                    wake = undefined;
                    resolve();
                }, timeoutMs);
                wake = () => {
                    clearTimeout(timer);
                    wake = undefined;
                    resolve();
                };
            });

            return session.take();
        },
        lastSeenAt: Date.now(),
    };

    return session;
};

export type TCNSPollingOptions = {
    /**
     * How long a `GET` parks before answering empty. Long enough that an idle
     * panel is not a request loop, short enough to stay under the read timeout of
     * whatever proxy made polling necessary in the first place.
     */
    waitMs?: number;
    /**
     * Drop a session not seen for this long. A polling participant has no `close`
     * event, so silence is the only signal that it is gone — and a session that is
     * never dropped keeps its queue, and its place in the action routing, forever.
     */
    sessionTtlMs?: number;
};

/**
 * Handles the two polling endpoints against a {@link CNSDevToolsServer}.
 *
 * - `POST …?sessionId=X` — body is one protocol message, same as a socket frame.
 * - `GET  …?sessionId=X` — resolves with the messages queued for that session,
 *   parking up to `waitMs` if there are none.
 *
 * Returns `undefined` for a request it does not recognise, so the caller can fall
 * through to serving the panel's assets.
 */
export class CNSDevToolsPollingTransport {
    private readonly sessions = new Map<string, ICNSPollingSession>();
    private readonly waitMs: number;
    private readonly sessionTtlMs: number;

    constructor(
        private readonly server: CNSDevToolsServer,
        options: TCNSPollingOptions = {}
    ) {
        this.waitMs = options.waitMs ?? 25_000;
        this.sessionTtlMs = options.sessionTtlMs ?? 60_000;
    }

    /** Sessions currently held. Exposed so a leak is observable in tests. */
    get sessionCount(): number {
        return this.sessions.size;
    }

    /** Deliver one message from a participant. */
    async post(sessionId: string, body: string): Promise<void> {
        const session = this.session(sessionId);
        await this.server.handleMessage(session.client as never, body);
    }

    /** Drain what is queued for a participant, parking if nothing is. */
    async poll(sessionId: string): Promise<string[]> {
        const session = this.session(sessionId);
        return session.wait(this.waitMs);
    }

    /** Forget a participant and take it out of the server's routing. */
    close(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        this.sessions.delete(sessionId);
        this.server.removeClient(session.client as never);
    }

    private session(sessionId: string): ICNSPollingSession {
        this.sweep();

        const existing = this.sessions.get(sessionId);
        if (existing) {
            existing.lastSeenAt = Date.now();
            return existing;
        }

        const created = createSession();
        this.sessions.set(sessionId, created);
        return created;
    }

    /** Drop sessions that stopped polling. Silence is the only signal they give. */
    private sweep(): void {
        const cutoff = Date.now() - this.sessionTtlMs;
        for (const [id, session] of this.sessions) {
            if (session.lastSeenAt < cutoff) {
                this.sessions.delete(id);
                this.server.removeClient(session.client as never);
            }
        }
    }
}
