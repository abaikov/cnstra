import { createCNSPollingTransport } from '../pollingTransport';
import { CNSFakePollingServer } from './CNSFakePollingServer';
import { CNSRecordingTransportHooks } from './CNSRecordingTransportHooks';

describe('polling transport', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('re-issues the poll as soon as a response comes back', async () => {
        const server = new CNSFakePollingServer();
        const hooks = new CNSRecordingTransportHooks();
        const transport = createCNSPollingTransport({ url: 'http://localhost:8080', hooks, sessionId: 'sess-1', fetch: server.fetch });

        await CNSFakePollingServer.flush();
        expect(server.gets()).toHaveLength(1);
        expect(server.gets()[0].url).toBe('http://localhost:8080/__cnstra/poll?sessionId=sess-1');
        expect(hooks.opens).toBe(1);

        await server.reply();
        expect(server.gets()).toHaveLength(2);

        await server.reply();
        expect(server.gets()).toHaveLength(3);

        transport.dispose();
    });

    it('delivers every frame of a poll response to onMessage', async () => {
        const server = new CNSFakePollingServer();
        const hooks = new CNSRecordingTransportHooks();
        const transport = createCNSPollingTransport({ url: 'http://localhost:8080', hooks, sessionId: 'sess-2', fetch: server.fetch });

        await CNSFakePollingServer.flush();
        await server.reply('{"type":"a"}', '{"type":"b"}');

        expect(hooks.messages).toEqual(['{"type":"a"}', '{"type":"b"}']);

        transport.dispose();
    });

    it('sends a frame as one POST to the session endpoint', async () => {
        const server = new CNSFakePollingServer();
        const transport = createCNSPollingTransport({ url: 'http://localhost:8080/', hooks: new CNSRecordingTransportHooks(), sessionId: 'sess-3', fetch: server.fetch });

        expect(transport.send('{"type":"client.connect"}')).toBe(true);
        await CNSFakePollingServer.flush();

        expect(server.posts()).toHaveLength(1);
        expect(server.posts()[0].body).toBe('{"type":"client.connect"}');
        expect(server.posts()[0].url).toBe('http://localhost:8080/__cnstra/poll?sessionId=sess-3');

        transport.dispose();
    });

    it('dispose stops the loop and drops the session with DELETE', async () => {
        const server = new CNSFakePollingServer();
        const hooks = new CNSRecordingTransportHooks();
        const transport = createCNSPollingTransport({ url: 'http://localhost:8080', hooks, sessionId: 'sess-4', fetch: server.fetch });

        await CNSFakePollingServer.flush();
        expect(server.gets()).toHaveLength(1);

        transport.dispose();
        await CNSFakePollingServer.flush();

        expect(server.deletes()).toHaveLength(1);
        expect(server.deletes()[0].url).toBe('http://localhost:8080/__cnstra/poll?sessionId=sess-4');

        await server.reply('{"type":"late"}');
        expect(hooks.messages).toEqual([]);
        expect(server.gets()).toHaveLength(1);
        expect(transport.send('{"type":"ignored"}')).toBe(false);
    });

    it('a failed poll backs off instead of looping tightly', async () => {
        jest.useFakeTimers();
        let fetchCalls = 0;
        const hooks = new CNSRecordingTransportHooks();
        const transport = createCNSPollingTransport({
            url: 'http://localhost:8080',
            hooks,
            sessionId: 'sess-5',
            backoffMs: 1000,
            maxBackoffMs: 8000,
            fetch: () => {
                fetchCalls++;
                return Promise.reject(new Error('network down'));
            },
        });

        await CNSFakePollingServer.flush();
        expect(fetchCalls).toBe(1);
        expect(hooks.errors).toEqual(['network down']);
        expect(hooks.closes).toEqual([{ code: 0, reason: 'poll failed', willRetry: true }]);

        await jest.advanceTimersByTimeAsync(999);
        expect(fetchCalls).toBe(1);

        await jest.advanceTimersByTimeAsync(1);
        expect(fetchCalls).toBe(2);

        await jest.advanceTimersByTimeAsync(1000);
        expect(fetchCalls).toBe(2);

        await jest.advanceTimersByTimeAsync(1000);
        expect(fetchCalls).toBe(3);

        expect(hooks.closes).toHaveLength(1);
        expect(hooks.errors).toHaveLength(3);

        transport.dispose();
    });
});
