import { request as httpRequest } from 'http';
import { WebSocket } from 'ws';
import { CNS } from '@cnstra/core';
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { CNSHomeostatTransductionQueryCodec } from '@cnstra/sync';
import { CNS_DEVTOOLS_SYNC_PATH } from '@cnstra/devtools-dto';
import { startCNSDevTools } from '../src/start';
import type { TCNSDevToolsHandle } from '../src/start';

describe('startCNSDevTools sync route', () => {
    let handle: TCNSDevToolsHandle | undefined;
    afterEach(() => handle?.stop());

    it('answers a GET of the sync path through the codec, without opening it to other origins', async () => {
        handle = await startCNSDevTools({ cns: new CNS([]), registry: CNSPersistOptionsRegistryFactory.create({}) }, { port: 43_141, open: false });
        const codec = CNSHomeostatTransductionQueryCodec.INSTANCE;
        const query = codec.encodeRequests([{ name: 'apps', key: [undefined] }, { name: 'scheduledPage', key: [undefined, undefined, undefined, 50] }]);

        const response = await fetch(`${handle.url}${CNS_DEVTOOLS_SYNC_PATH}?${query}`, { headers: { accept: codec.mediaType } });

        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        const rows = codec.decodeRows(await response.text(), query);
        expect(rows.map(row => row.name)).toEqual(['apps', 'scheduledPage']);
    });

    it('refuses anything but GET on the sync path', async () => {
        handle = await startCNSDevTools({ cns: new CNS([]), registry: CNSPersistOptionsRegistryFactory.create({}) }, { port: 43_142, open: false });
        expect((await fetch(`${handle.url}${CNS_DEVTOOLS_SYNC_PATH}`, { method: 'POST' })).status).toBe(405);
    });
});

describe('startCNSDevTools defaults', () => {
    let handle: TCNSDevToolsHandle | undefined;
    afterEach(() => {
        handle?.stop();
        handle = undefined;
    });

    const source = () => ({ cns: new CNS([]), registry: CNSPersistOptionsRegistryFactory.create({}) });

    const upgrade = (url: string, headers: Record<string, string>): Promise<boolean> =>
        new Promise(resolve => {
            const socket = new WebSocket(url, { headers });
            socket.on('open', () => {
                socket.close();
                resolve(true);
            });
            socket.on('unexpected-response', () => resolve(false));
            socket.on('error', () => resolve(false));
        });

    it('binds to 127.0.0.1 unless told otherwise', async () => {
        handle = await startCNSDevTools(source(), { port: 0, open: false });
        expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('lets a non-browser client and the panel of this server upgrade, and no other web page', async () => {
        handle = await startCNSDevTools(source(), { port: 0, open: false, webSocket: {} });
        const socketUrl = handle.url.replace(/^http/, 'ws');
        const host = handle.url.slice('http://'.length);
        const port = host.split(':')[1];

        expect(await upgrade(socketUrl, {})).toBe(true);
        expect(await upgrade(socketUrl, { origin: handle.url })).toBe(true);
        expect(await upgrade(socketUrl, { origin: 'https://evil.example' })).toBe(false);
        expect(await upgrade(socketUrl, { origin: `http://localhost:${Number(port) + 1}` })).toBe(false);
        expect(await upgrade(socketUrl, { host: `evil.example:${port}`, origin: `http://evil.example:${port}` })).toBe(false);
    });

    const statusWithHost = (url: string, host: string): Promise<number | undefined> =>
        new Promise((resolve, reject) => {
            const request = httpRequest(url, { headers: { host } }, response => {
                response.resume();
                resolve(response.statusCode);
            });
            request.on('error', reject);
            request.end();
        });

    it('refuses an HTTP request whose Host is not this loopback server, as a DNS-rebinding page sends', async () => {
        handle = await startCNSDevTools(source(), { port: 0, open: false });
        const port = handle.url.split(':')[2];
        const syncUrl = `${handle.url}${CNS_DEVTOOLS_SYNC_PATH}`;

        expect(await statusWithHost(syncUrl, `evil.example:${port}`)).toBe(403);
        expect(await statusWithHost(syncUrl, `localhost:${Number(port) + 1}`)).toBe(403);
        expect(await statusWithHost(syncUrl, `localhost:${port}`)).not.toBe(403);
        expect(await statusWithHost(syncUrl, `127.0.0.1:${port}`)).not.toBe(403);
    });

    it('throws instead of reporting a server that failed to start', async () => {
        const errors = console.error;
        console.error = () => undefined;
        const broken = source();
        broken.cns.addResponseListener = () => {
            throw new Error('cns refused');
        };
        try {
            await expect(startCNSDevTools(broken, { port: 0, open: false })).rejects.toThrow('cns refused');
        } finally {
            console.error = errors;
        }
    });
});
