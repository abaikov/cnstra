import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import type { TCNSPollingFetch } from '../types/TCNSPollingFetch';
import type { TCNSPollingTransportOptions } from '../types/TCNSPollingTransportOptions';
import { CNSErrorMessage } from '../utils/CNSErrorMessage';

const POLL_PATH = '/__cnstra/poll';
const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;

const createSessionId = (): string => `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isPollResponseBody = (body: unknown): body is { messages: string[] } =>
    typeof body === 'object' &&
    body !== null &&
    'messages' in body &&
    Array.isArray(body.messages) &&
    body.messages.every(message => typeof message === 'string');

export function createCNSPollingTransport(options: TCNSPollingTransportOptions): ICNSDevToolsTransport {
    const { hooks } = options;
    const firstBackoffMs = options.backoffMs ?? FIRST_BACKOFF_MS;
    const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    const sessionId = options.sessionId ?? createSessionId();
    const endpoint = `${options.url.replace(/\/+$/, '')}${POLL_PATH}?sessionId=${encodeURIComponent(sessionId)}`;
    const doFetch: TCNSPollingFetch = (input, init) => (options.fetch ? options.fetch(input, init) : globalThis.fetch(input, init));

    const abort = new AbortController();
    let disposed = false;
    let failing = false;
    let backoffMs = firstBackoffMs;
    let wake: (() => void) | null = null;
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
        await Promise.resolve();
        if (disposed) return;
        hooks.onOpen();

        while (!disposed) {
            try {
                const response = await doFetch(endpoint, { method: 'GET', signal: abort.signal });
                if (!response.ok) throw new Error(`poll responded ${response.status}`);
                const body: unknown = await response.json();
                if (disposed) return;

                if (failing) {
                    failing = false;
                    hooks.onOpen();
                }
                backoffMs = firstBackoffMs;
                if (isPollResponseBody(body)) for (const message of body.messages) hooks.onMessage(message);
            } catch (error) {
                if (disposed) return;
                hooks.onError({ message: CNSErrorMessage.of(error) });
                if (!failing) {
                    failing = true;
                    hooks.onClose({ code: 0, reason: 'poll failed', willRetry: true });
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
                .then(() => doFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: data }))
                .then(response => {
                    if (!response.ok) throw new Error(`send responded ${response.status}`);
                })
                .catch(error => {
                    if (disposed) return;
                    hooks.onError({ message: CNSErrorMessage.of(error) });
                });
            return true;
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            wake?.();
            abort.abort();
            void doFetch(endpoint, { method: 'DELETE' }).catch(() => {});
        },
    };
}
