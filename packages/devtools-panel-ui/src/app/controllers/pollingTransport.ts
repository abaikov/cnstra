import type {
    ICNSDevtoolsTransport,
    TCNSDevToolsTransportHooks,
} from './socket';

/**
 * The DevTools protocol over plain HTTP.
 *
 * Same frames as the socket, three endpoints instead of one connection:
 *
 * - `POST   …/poll?sessionId=X` — body is one frame; answers 204.
 * - `GET    …/poll?sessionId=X` — answers `{"messages": string[]}`, parking for
 *   up to ~25s when nothing is queued and returning the moment something is. So
 *   the loop below re-issues immediately on every response: it is a long poll,
 *   not a busy one.
 * - `DELETE …/poll?sessionId=X` — drops the session. Without it the server holds
 *   the mailbox until its ~60s sweep.
 *
 * The session id is minted here, one per panel instance — it is what the server
 * routes this participant by, the way a socket instance is on the other wire.
 */

/** Path the devtools server serves the polling endpoints on. */
export const CNS_POLL_PATH = '/__cnstra/poll';

const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;

export type TCNSPollingTransportOptions = {
    /** HTTP origin of the devtools server, e.g. `http://localhost:8080`. */
    url: string;
    hooks: TCNSDevToolsTransportHooks;
    /** One per panel instance. Passed in only by tests. */
    sessionId?: string;
    /** Wait after the first failed request; doubles up to `maxBackoffMs`. */
    backoffMs?: number;
    maxBackoffMs?: number;
    /** Passed in only by tests. */
    fetchImpl?: typeof fetch;
};

const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const genSessionId = (): string =>
    `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createPollingTransport(
    options: TCNSPollingTransportOptions
): ICNSDevtoolsTransport {
    const { hooks } = options;
    const firstBackoffMs = options.backoffMs ?? FIRST_BACKOFF_MS;
    const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    const sessionId = options.sessionId ?? genSessionId();
    const endpoint = `${options.url.replace(/\/+$/, '')}${CNS_POLL_PATH}?sessionId=${encodeURIComponent(sessionId)}`;
    // Resolved per call so a test can install its own `fetch` after import.
    const doFetch: typeof fetch = (input, init) =>
        (options.fetchImpl ?? globalThis.fetch)(input, init);

    const abort = new AbortController();
    let disposed = false;
    /** True while polls are failing — set so recovery can re-announce itself. */
    let failing = false;
    let backoffMs = firstBackoffMs;
    /** Cuts the backoff wait short so `dispose()` does not have to sit it out. */
    let wake: (() => void) | null = null;
    /** POSTs go out one at a time: `client.connect` must land before the queries. */
    let outbound: Promise<void> = Promise.resolve();

    const sleep = (ms: number): Promise<void> =>
        new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                wake = null;
                resolve();
            }, ms);
            wake = () => {
                clearTimeout(timer);
                wake = null;
                resolve();
            };
        });

    const run = async (): Promise<void> => {
        // Deferred one microtask: the controller only wires its `send` once this
        // factory has returned, and `onOpen` sends the handshake through it.
        await Promise.resolve();
        if (disposed) return;
        hooks.onOpen();

        while (!disposed) {
            try {
                const response = await doFetch(endpoint, {
                    method: 'GET',
                    signal: abort.signal,
                });
                if (!response.ok)
                    throw new Error(`poll responded ${response.status}`);
                const body = (await response.json()) as {
                    messages?: string[];
                } | null;
                if (disposed) return;

                if (failing) {
                    // The server may have restarted and forgotten this session,
                    // so re-announce rather than assume it still knows us.
                    failing = false;
                    hooks.onOpen();
                }
                backoffMs = firstBackoffMs;
                for (const message of body?.messages ?? [])
                    hooks.onMessage(message);
            } catch (error) {
                if (disposed) return;
                hooks.onError({ message: messageOf(error) });
                if (!failing) {
                    failing = true;
                    hooks.onClose({
                        code: 0,
                        reason: 'poll failed',
                        willRetry: true,
                    });
                }
                await sleep(backoffMs);
                backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
            }
        }
    };

    void run();

    return {
        send: (data: string): boolean => {
            if (disposed) return false;
            outbound = outbound
                .then(() =>
                    doFetch(endpoint, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: data,
                    })
                )
                .then(response => {
                    if (!response.ok)
                        throw new Error(`send responded ${response.status}`);
                })
                .catch(error => {
                    if (disposed) return;
                    hooks.onError({ message: messageOf(error) });
                });
            // Optimistic: a POST is in flight, and a reply that never comes is
            // the request layer's timeout to report, not this one's.
            return true;
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            wake?.();
            abort.abort();
            // Best effort — the server sweeps a silent session anyway.
            void doFetch(endpoint, { method: 'DELETE' }).catch(() => {});
        },
    };
}
