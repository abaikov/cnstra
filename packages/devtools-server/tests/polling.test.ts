import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsPollingTransport } from '../src/pollingTransport';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';

/**
 * Polling is the fallback for a network that will not carry a WebSocket upgrade.
 * What must hold: the same protocol, the same server, no socket — and no session
 * left behind when a participant stops polling, because a polling client has no
 * `close` event to tell us it is gone.
 */

const build = () => ({
    server: new CNSDevToolsServer(
        new CNSDevToolsServerRepositoryInMemory(),
        new CNSInMemoryStimulationRepository()
    ),
});

describe('CNSDevToolsPollingTransport', () => {

    it('answers a connect over HTTP with what the socket would have sent', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server);

        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));
        const messages = (await polling.poll('ui-1')).map(m => JSON.parse(m));

        expect(messages.map(m => m.type)).toEqual(['ui.config']);
    });

    it('drains: a second poll does not repeat what the first already took', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, { waitMs: 5 });

        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));
        const first = await polling.poll('ui-1');
        const second = await polling.poll('ui-1');

        expect(first.length).toBeGreaterThan(0);
        expect(second).toEqual([]);
    });

    it('parks an idle poll instead of answering empty immediately', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, { waitMs: 60 });

        const started = Date.now();
        await polling.poll('ui-1');

        // Without parking, an idle panel is a request loop.
        expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    });

    it('wakes a parked poll the moment a message is queued', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, { waitMs: 5_000 });

        // Park first, then push — the order that matters.
        const parked = polling.poll('ui-1');
        await new Promise(r => setTimeout(r, 10));
        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));

        const messages = await parked;
        expect(messages.length).toBeGreaterThan(0);
    });

    it('keeps sessions apart', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, { waitMs: 5 });

        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));

        expect((await polling.poll('ui-1')).length).toBeGreaterThan(0);
        expect(await polling.poll('ui-2')).toEqual([]);
    });

    it('forgets a session that stopped polling', async () => {
        // A polling client has no `close` event; silence is the only signal, and a
        // session kept forever keeps its queue and its place in action routing.
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, {
            waitMs: 5,
            sessionTtlMs: 20,
        });

        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));
        expect(polling.sessionCount).toBe(1);

        await new Promise(r => setTimeout(r, 40));
        // Any later use sweeps the expired ones.
        await polling.post('ui-2', JSON.stringify({ type: 'client.connect' }));

        expect(polling.sessionCount).toBe(1);
    });

    it('a session still polling is not swept', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, {
            waitMs: 5,
            sessionTtlMs: 60,
        });

        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));
        await new Promise(r => setTimeout(r, 30));
        await polling.poll('ui-1'); // keeps it alive
        await new Promise(r => setTimeout(r, 30));
        await polling.post('ui-2', JSON.stringify({ type: 'client.connect' }));

        expect(polling.sessionCount).toBe(2);
    });

    it('close() takes the session out of the server routing too', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server);

        await polling.post('ui-1', JSON.stringify({ type: 'client.connect' }));
        polling.close('ui-1');

        expect(polling.sessionCount).toBe(0);
    });

    it('close() releases a parked poll at once', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, { waitMs: 5_000 });

        const parked = polling.poll('ui-1');
        polling.close('ui-1');

        await expect(parked).resolves.toEqual([]);
    });

    it('dispose() drops every session', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server, { waitMs: 5_000 });

        const parked = [polling.poll('ui-1'), polling.poll('ui-2')];
        polling.dispose();

        await expect(Promise.all(parked)).resolves.toEqual([[], []]);
        expect(polling.sessionCount).toBe(0);
    });

    it('ignores a malformed body rather than throwing at the endpoint', async () => {
        const { server } = build();
        const polling = new CNSDevToolsPollingTransport(server);

        await expect(polling.post('ui-1', 'not json')).resolves.toBeUndefined();
    });
});
