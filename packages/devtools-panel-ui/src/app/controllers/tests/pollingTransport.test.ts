/**
 * The HTTP long-polling transport, and the devtools socket riding on it.
 *
 * A WebSocket is the default wire, but an upgrade does not survive every network,
 * so the panel can opt into polling with `?transport=polling`. These cover the
 * loop's shape (re-issue on response, back off on failure, DELETE on dispose) and
 * the fact that a request/reply still correlates by `requestId` over HTTP.
 */

import { createPollingTransport } from '.././pollingTransport';
import { createDevtoolsSocket } from '.././socket';
import type { TCNSDevToolsTransportHooks } from '.././socket';
import { socketRequest } from '../../../explorer/socketRequest';

type TCall = { method: string; url: string; body?: string };

/** Let every already-queued microtask run (the loop is all promises). */
const flush = async (turns = 12): Promise<void> => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

/**
 * A stand-in for the three endpoints: POST/DELETE answer at once, a GET parks
 * until the test answers it — exactly the long poll the real server does.
 */
function makeFakeServer() {
    const calls: TCall[] = [];
    const parked: Array<(messages: string[]) => void> = [];

    const fetchImpl = jest.fn((input: unknown, init: any = {}) => {
        const method = (init.method ?? 'GET') as string;
        calls.push({ method, url: String(input), body: init.body });
        if (method !== 'GET')
            return Promise.resolve({
                ok: true,
                status: 204,
                json: async () => ({}),
            });
        return new Promise(resolve => {
            parked.push(messages =>
                resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ messages }),
                })
            );
        });
    });

    const of = (method: string) => calls.filter(c => c.method === method);

    return {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        calls,
        gets: () => of('GET'),
        posts: () => of('POST'),
        deletes: () => of('DELETE'),
        /** Answer the oldest parked poll with these frames. */
        reply: async (...messages: string[]): Promise<void> => {
            const answer = parked.shift();
            if (!answer) throw new Error('no poll in flight');
            answer(messages);
            await flush();
        },
    };
}

const makeHooks = (): TCNSDevToolsTransportHooks => ({
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onError: jest.fn(),
    onMessage: jest.fn(),
});

describe('polling transport', () => {
    // The backoff case runs on fake timers; make sure a failure there cannot
    // leave them installed for everything after it.
    afterEach(() => {
        jest.useRealTimers();
    });

    it('re-issues the poll as soon as a response comes back', async () => {
        const server = makeFakeServer();
        const hooks = makeHooks();
        const transport = createPollingTransport({
            url: 'http://localhost:8080',
            hooks,
            sessionId: 'sess-1',
            fetchImpl: server.fetchImpl,
        });

        await flush();
        expect(server.gets()).toHaveLength(1);
        expect(server.gets()[0].url).toBe(
            'http://localhost:8080/__cnstra/poll?sessionId=sess-1'
        );
        expect(hooks.onOpen).toHaveBeenCalledTimes(1);

        await server.reply();
        expect(server.gets()).toHaveLength(2);

        await server.reply();
        expect(server.gets()).toHaveLength(3);

        transport.dispose();
    });

    it('delivers every frame of a poll response to onMessage', async () => {
        const server = makeFakeServer();
        const hooks = makeHooks();
        const transport = createPollingTransport({
            url: 'http://localhost:8080',
            hooks,
            sessionId: 'sess-2',
            fetchImpl: server.fetchImpl,
        });

        await flush();
        await server.reply('{"type":"a"}', '{"type":"b"}');

        expect((hooks.onMessage as jest.Mock).mock.calls.map(c => c[0])).toEqual(
            ['{"type":"a"}', '{"type":"b"}']
        );

        transport.dispose();
    });

    it('sends a frame as one POST to the session endpoint', async () => {
        const server = makeFakeServer();
        const transport = createPollingTransport({
            url: 'http://localhost:8080/',
            hooks: makeHooks(),
            sessionId: 'sess-3',
            fetchImpl: server.fetchImpl,
        });

        expect(transport.send('{"type":"client.connect"}')).toBe(true);
        await flush();

        expect(server.posts()).toHaveLength(1);
        expect(server.posts()[0].body).toBe('{"type":"client.connect"}');
        expect(server.posts()[0].url).toBe(
            'http://localhost:8080/__cnstra/poll?sessionId=sess-3'
        );

        transport.dispose();
    });

    it('dispose stops the loop and drops the session with DELETE', async () => {
        const server = makeFakeServer();
        const hooks = makeHooks();
        const transport = createPollingTransport({
            url: 'http://localhost:8080',
            hooks,
            sessionId: 'sess-4',
            fetchImpl: server.fetchImpl,
        });

        await flush();
        expect(server.gets()).toHaveLength(1);

        transport.dispose();
        await flush();

        expect(server.deletes()).toHaveLength(1);
        expect(server.deletes()[0].url).toBe(
            'http://localhost:8080/__cnstra/poll?sessionId=sess-4'
        );

        // The poll that was in flight when we disposed answers late: it must be
        // dropped, and it must not start another round.
        await server.reply('{"type":"late"}');
        expect(hooks.onMessage).not.toHaveBeenCalled();
        expect(server.gets()).toHaveLength(1);
        expect(transport.send('{"type":"ignored"}')).toBe(false);
    });

    it('a failed poll backs off instead of looping tightly', async () => {
        jest.useFakeTimers();
        const fetchImpl = jest.fn(() =>
            Promise.reject(new Error('network down'))
        ) as unknown as typeof fetch;
        const hooks = makeHooks();
        const transport = createPollingTransport({
            url: 'http://localhost:8080',
            hooks,
            sessionId: 'sess-5',
            backoffMs: 1000,
            maxBackoffMs: 8000,
            fetchImpl,
        });

        await flush();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(hooks.onError).toHaveBeenCalledTimes(1);
        expect(hooks.onClose).toHaveBeenCalledWith({
            code: 0,
            reason: 'poll failed',
            willRetry: true,
        });

        // Still parked one tick before the first backoff elapses.
        await jest.advanceTimersByTimeAsync(999);
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        // The wait doubled, so the same 1000ms is no longer enough.
        await jest.advanceTimersByTimeAsync(1000);
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(1000);
        expect(fetchImpl).toHaveBeenCalledTimes(3);

        // One close for the outage, not one per failed attempt.
        expect(hooks.onClose).toHaveBeenCalledTimes(1);
        expect(hooks.onError).toHaveBeenCalledTimes(3);

        transport.dispose();
        jest.useRealTimers();
    });
});

describe('devtools socket transport selection', () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        (globalThis as any).fetch = realFetch;
        window.history.replaceState({}, '', '/');
    });

    it('defaults to the WebSocket and makes no HTTP requests', async () => {
        const server = makeFakeServer();
        (globalThis as any).fetch = server.fetchImpl;

        const socket = createDevtoolsSocket();
        await flush();

        expect(socket.transport.getValue()).toBe('socket');
        expect(server.calls).toHaveLength(0);

        socket.dispose();
    });

    it('?transport=polling carries a request and its reply over HTTP', async () => {
        const server = makeFakeServer();
        (globalThis as any).fetch = server.fetchImpl;
        window.history.replaceState({}, '', '/?transport=polling');

        const socket = createDevtoolsSocket();
        await flush();

        expect(socket.transport.getValue()).toBe('polling');
        expect(socket.connectionStatus.getValue()).toBe('connected');
        // The handshake goes out over POST, identifying first.
        expect(JSON.parse(server.posts()[0].body as string).type).toBe(
            'client.connect'
        );

        const reply = socketRequest<number>(
            socket,
            { type: 'ping', requestId: 'req-poll-1' },
            (m, resolve) => resolve(m.value)
        );
        await flush();

        await server.reply(
            JSON.stringify({ type: 'pong', requestId: 'req-poll-1', value: 42 })
        );

        await expect(reply).resolves.toBe(42);
        socket.dispose();
    });

    it('socketRequest ignores a reply whose requestId does not match', async () => {
        const server = makeFakeServer();
        (globalThis as any).fetch = server.fetchImpl;
        window.history.replaceState({}, '', '/?transport=polling');

        const socket = createDevtoolsSocket();
        await flush();

        const onReply = jest.fn((m: any, resolve: (v: number) => void) =>
            resolve(m.value)
        );
        const reply = socketRequest<number>(
            socket,
            { type: 'ping', requestId: 'req-poll-2' },
            onReply
        );
        await flush();

        await server.reply(
            JSON.stringify({ type: 'pong', requestId: 'someone-else', value: 1 }),
            'not json at all'
        );
        expect(onReply).not.toHaveBeenCalled();

        await server.reply(
            JSON.stringify({ type: 'pong', requestId: 'req-poll-2', value: 7 })
        );
        expect(onReply).toHaveBeenCalledTimes(1);
        await expect(reply).resolves.toBe(7);

        socket.dispose();
    });
});
