import { createServer } from 'http';
import type { RequestListener, Server } from 'http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WebSocket } from 'ws';
import { CNS, collateral, neuron } from '@cnstra/core';
import {
    CNSInMemoryStimulationRepository,
    CNSPersistOptionsRegistry,
    CNSPersistOptionsRegistryFactory,
    CNS_JOB_IDENTITY_CONTEXT_KEY,
} from '@cnstra/persist';
import type { TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import { CNSHomeostatTransductionQueryCodec } from '@cnstra/sync';
import { CNS_DEVTOOLS_SYNC_PATH } from '@cnstra/devtools-dto';
import { createCNSDevToolsHandler } from '../src/createCNSDevToolsHandler';
import { CNSDevToolsPanelPage } from '../src/CNSDevToolsPanelPage';
import type { TCNSDevToolsHandler } from '../src/TCNSDevToolsHandler';
import type { TCNSDevToolsHandlerOptions } from '../src/TCNSDevToolsHandlerOptions';
import type { TCNSDevToolsSource } from '../src/TCNSDevToolsSource';

const PANEL_HTML = `<!doctype html>
<html lang="en">
    <head>
        <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
        <script type="module" crossorigin src="./assets/index-abc123.js"></script>
        <link rel="stylesheet" crossorigin href="./assets/index-def456.css">
    </head>
    <body><div id="root"></div></body>
</html>`;

const codec = CNSHomeostatTransductionQueryCodec.INSTANCE;
const JSON_HEADERS = { 'content-type': 'application/json' };
const origin = 'http://localhost';

const source = (): TCNSDevToolsSource => ({ cns: new CNS([]), registry: CNSPersistOptionsRegistryFactory.create({}) });

const appIdsOf = async (admin: TCNSDevToolsHandler, basePath = ''): Promise<unknown[]> => {
    const query = codec.encodeRequests([{ name: 'apps', key: [undefined] }]);
    const response = await admin.fetch(new Request(`${origin}${basePath}${CNS_DEVTOOLS_SYNC_PATH}?${query}`, { headers: { accept: codec.mediaType } }));
    const [row] = codec.decodeRows(await response.text(), query);
    const data: unknown = 'data' in row ? row.data : undefined;
    return typeof data === 'object' && data !== null && 'apps' in data && Array.isArray(data.apps) ? data.apps.map(app => app.id) : [];
};

const messagesOf = async (response: Response): Promise<Array<{ type: string; [key: string]: unknown }>> => {
    const body: { messages: string[] } = await response.json();
    return body.messages.map(message => JSON.parse(message));
};

describe('createCNSDevToolsHandler', () => {
    let root: string;
    let panelDirectory: string;
    const handlers: TCNSDevToolsHandler[] = [];
    const servers: Server[] = [];

    const build = (options: TCNSDevToolsHandlerOptions = {}, from: TCNSDevToolsSource = source()) => {
        const handler = createCNSDevToolsHandler(from, { polling: { waitMs: 20 }, ...options });
        handlers.push(handler);
        return handler;
    };

    const listen = async (listener: RequestListener): Promise<{ server: Server; url: string }> => {
        const server = createServer(listener);
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        return { server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` };
    };

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'cnstra-admin-'));
        panelDirectory = join(root, 'dist');
        mkdirSync(join(panelDirectory, 'assets'), { recursive: true });
        writeFileSync(join(panelDirectory, 'index.html'), PANEL_HTML);
        writeFileSync(join(panelDirectory, 'favicon.svg'), '<svg/>');
        writeFileSync(join(panelDirectory, 'assets', 'index-abc123.js'), 'export {};');
        writeFileSync(join(root, 'secret.txt'), 'secret');
    });

    beforeEach(() => {
        jest.spyOn(CNSDevToolsPanelPage, 'locate').mockReturnValue(panelDirectory);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await Promise.all(handlers.splice(0).map(handler => handler.dispose()));
        await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
    });

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    describe('the panel page', () => {
        it('is served at basePath with and without the trailing slash', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            for (const path of ['/admin/cnstra', '/admin/cnstra/']) {
                const response = await admin.fetch(new Request(`${origin}${path}`));
                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toMatch(/^text\/html/);
            }
        });

        it('embeds the config before the first script and points asset URLs at basePath', async () => {
            const admin = build({ basePath: '/admin/cnstra/', readOnly: true });
            const html = await (await admin.fetch(new Request(`${origin}/admin/cnstra`))).text();

            const config = '<script type="application/json" id="cnstra-devtools-config">{"basePath":"/admin/cnstra","transport":"polling","readOnly":true}</script>';
            expect(html.indexOf(config)).toBeGreaterThan(0);
            expect(html.indexOf(config)).toBeLessThan(html.indexOf('<script type="module"'));
            expect(html).toContain('src="/admin/cnstra/assets/index-abc123.js"');
            expect(html).toContain('href="/admin/cnstra/favicon.svg"');
            expect(html).not.toContain('"./');
        });

        it('tells the panel to use a socket only when a WebSocket is configured', async () => {
            const admin = build({ webSocket: { authorizeUpgrade: () => true } });
            const html = await (await admin.fetch(new Request(`${origin}/`))).text();
            expect(html).toContain('{"basePath":"/","transport":"socket","readOnly":false}');
            expect(html).not.toContain('panel-address');
        });


        it('answers 503 when the panel is not installed', async () => {
            jest.spyOn(CNSDevToolsPanelPage, 'locate').mockReturnValue(undefined);
            const admin = build();
            expect((await admin.fetch(new Request(`${origin}/`))).status).toBe(503);
        });
    });

    describe('static files', () => {
        it('serves hashed assets as immutable, with their content type', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const response = await admin.fetch(new Request(`${origin}/admin/cnstra/assets/index-abc123.js`));
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toMatch(/^text\/javascript/);
            expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
            expect(await response.text()).toBe('export {};');
        });

        it('serves an unhashed file with revalidation', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const response = await admin.fetch(new Request(`${origin}/admin/cnstra/favicon.svg`));
            expect(response.headers.get('content-type')).toBe('image/svg+xml');
            expect(response.headers.get('cache-control')).toBe('no-cache');
        });

        it('refuses a path that climbs out of the panel build', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const response = await admin.fetch(new Request(`${origin}/admin/cnstra/..%2fsecret.txt`));
            expect(response.status).toBe(403);
            expect(await response.text()).not.toContain('secret');
        });
    });

    describe('routing', () => {
        it('answers 404 for an unknown path under basePath and for a path outside it', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            expect((await admin.fetch(new Request(`${origin}/admin/cnstra/nope`))).status).toBe(404);
            expect((await admin.fetch(new Request(`${origin}/elsewhere`))).status).toBe(404);
            expect((await admin.fetch(new Request(`${origin}/admin/cnstrax`))).status).toBe(404);
        });

        it('the Node form calls next for anything that is not the panel', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const passed: string[] = [];
            const { url } = await listen((request, response) => {
                void admin.node(request, response, () => {
                    passed.push(request.url ?? '');
                    response.writeHead(418);
                    response.end();
                });
            });

            expect((await fetch(`${url}/admin/cnstra/nope`)).status).toBe(418);
            expect((await fetch(`${url}/elsewhere`)).status).toBe(418);
            expect((await fetch(`${url}/admin/cnstra/`)).status).toBe(200);
            expect(passed).toEqual(['/admin/cnstra/nope', '/elsewhere']);
        });

        it('the Node form answers 404 itself when there is no next', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const { url } = await listen((request, response) => void admin.node(request, response));
            expect((await fetch(`${url}/admin/cnstra/nope`)).status).toBe(404);
        });

        it('the Node form reads the full path from originalUrl when a framework mounted it', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const { url } = await listen((request, response) => {
                Object.assign(request, { originalUrl: request.url, url: (request.url ?? '').slice('/admin/cnstra'.length) || '/' });
                void admin.node(request, response);
            });
            expect((await fetch(`${url}/admin/cnstra/favicon.svg`)).status).toBe(200);
        });
    });

    describe('the polling endpoint', () => {
        it('carries the protocol under basePath, in both forms', async () => {
            const admin = build({ basePath: '/admin/cnstra' });
            const poll = `${origin}/admin/cnstra/__cnstra/poll?sessionId=panel-1`;

            const posted = await admin.fetch(new Request(poll, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type: 'client.connect' }) }));
            expect(posted.status).toBe(204);
            const messages = await messagesOf(await admin.fetch(new Request(poll)));
            expect(messages.map(message => message.type)).toEqual(['ui.config']);

            const { url } = await listen((request, response) => void admin.node(request, response));
            const nodePoll = `${url}/admin/cnstra/__cnstra/poll?sessionId=panel-2`;
            expect((await fetch(nodePoll, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type: 'client.connect' }) })).status).toBe(204);
            expect((await messagesOf(await fetch(nodePoll))).map(message => message.type)).toEqual(['ui.config']);
        });

        it('requires a session id', async () => {
            const admin = build();
            expect((await admin.fetch(new Request(`${origin}/__cnstra/poll`))).status).toBe(400);
        });

        it('refuses a POST that is not application/json, so a cross-site form cannot send one', async () => {
            const ran: string[] = [];
            const admin = build({ actions: [async action => void ran.push(action.type)] });
            const launch = JSON.stringify({ type: 'stimulation.launch', requestId: 'request-1', entry: { collateralName: 'orderPlaced', payload: {} } });
            for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
                const response = await admin.fetch(
                    new Request(`${origin}/__cnstra/poll?sessionId=s`, { method: 'POST', headers: { 'content-type': contentType }, body: launch })
                );
                expect(response.status).toBe(415);
            }
            expect(ran).toEqual([]);
            const accepted = await admin.fetch(
                new Request(`${origin}/__cnstra/poll?sessionId=s`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: launch })
            );
            expect(accepted.status).toBe(204);
            expect(ran).toEqual(['launch']);
        });

        it('never registers a polling client as an app', async () => {
            const admin = build({ appId: 'orders' });
            const topology = {
                type: 'batch',
                items: [{ type: 'topology', appId: 'intruder', cnsId: 'intruder:cns', appName: 'intruder', version: '1', timestamp: Date.now(), neurons: [], collaterals: [], dendrites: [] }],
            };
            await admin.fetch(new Request(`${origin}/__cnstra/poll?sessionId=s`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(topology) }));
            await new Promise(resolve => setTimeout(resolve, 20));

            expect(await appIdsOf(admin)).toEqual(['orders']);
        });

        it('decodes a body a framework already parsed into a Buffer as UTF-8', async () => {
            const admin = build();
            const { url } = await listen((request, response) => {
                const chunks: Buffer[] = [];
                request.on('data', chunk => chunks.push(chunk));
                request.on('end', () => {
                    Object.assign(request, { body: Buffer.concat(chunks) });
                    void admin.node(request, response);
                });
            });
            const poll = `${url}/__cnstra/poll?sessionId=s`;
            expect((await fetch(poll, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type: 'client.connect' }) })).status).toBe(204);
            expect((await messagesOf(await fetch(poll))).map(message => message.type)).toEqual(['ui.config']);
        });

        it('sends no CORS headers', async () => {
            const admin = build();
            const response = await admin.fetch(new Request(`${origin}/__cnstra/poll?sessionId=s`));
            expect(response.headers.get('access-control-allow-origin')).toBeNull();
        });
    });

    describe('the sync endpoint', () => {
        it('answers under basePath and sees the app linked in-process', async () => {
            const admin = build({ basePath: '/admin/cnstra', appId: 'orders' });
            const query = codec.encodeRequests([{ name: 'apps', key: [undefined] }]);
            const read = async () => {
                const response = await admin.fetch(
                    new Request(`${origin}/admin/cnstra${CNS_DEVTOOLS_SYNC_PATH}?${query}`, { headers: { accept: codec.mediaType } })
                );
                expect(response.status).toBe(200);
                const [row] = codec.decodeRows(await response.text(), query);
                const data: unknown = 'data' in row ? row.data : undefined;
                return typeof data === 'object' && data !== null && 'apps' in data && Array.isArray(data.apps)
                    ? data.apps.map(app => app.id)
                    : [];
            };

            await read();
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(await read()).toEqual(['orders']);
        });

        it('refuses anything but GET', async () => {
            const admin = build();
            expect((await admin.fetch(new Request(`${origin}${CNS_DEVTOOLS_SYNC_PATH}`, { method: 'POST' }))).status).toBe(405);
        });
    });

    describe('read-only', () => {
        it('hides the actions and refuses an action without running any link', async () => {
            const ran: string[] = [];
            const link: TCNSDevToolsActionMiddleware = async action => void ran.push(action.type);
            const admin = build({ readOnly: true, actions: [link] });
            const poll = `${origin}/__cnstra/poll?sessionId=panel-1`;

            await admin.fetch(new Request(poll, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type: 'client.connect' }) }));
            await admin.fetch(
                new Request(poll, {
                    method: 'POST',
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ type: 'stimulation.launch', requestId: 'request-1', entry: { collateralName: 'orderPlaced', payload: {} } }),
                })
            );
            const messages = await messagesOf(await admin.fetch(new Request(poll)));

            expect(messages.find(message => message.type === 'ui.config')?.actions).toEqual({ retry: false, clone: false });
            expect(messages.find(message => message.type === 'stimulation.launch.rejected')?.reason).toBe('the devtools are read-only');
            expect(ran).toEqual([]);
        });

        it('runs the extra links when it is not read-only', async () => {
            const ran: string[] = [];
            const link: TCNSDevToolsActionMiddleware = async action => void ran.push(action.type);
            const admin = build({ actions: [link] });
            const poll = `${origin}/__cnstra/poll?sessionId=panel-1`;

            await admin.fetch(
                new Request(poll, {
                    method: 'POST',
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ type: 'stimulation.launch', requestId: 'request-1', entry: { collateralName: 'orderPlaced', payload: {} } }),
                })
            );
            const messages = await messagesOf(await admin.fetch(new Request(poll)));

            expect(ran).toEqual(['launch']);
            expect(messages.map(message => message.type)).toContain('stimulation.launch.accepted');
        });
    });

    describe('a failed start', () => {
        it('rejects ready() and still disposes cleanly', async () => {
            const consoleError = console.error;
            console.error = () => undefined;
            const broken = source();
            const admin = createCNSDevToolsHandler(broken);
            broken.cns.addResponseListener = () => {
                throw new Error('cns refused');
            };
            try {
                await expect(admin.ready()).rejects.toThrow('cns refused');
                await expect(admin.dispose()).resolves.toBeUndefined();
            } finally {
                console.error = consoleError;
            }
        });
    });

    describe('the history', () => {
        it('records a worker job once, under its job id, through the in-process link', async () => {
            const entry = collateral<{ orderId: string }>();
            const placed = collateral<{ orderId: string }>();
            const orders = neuron({ placed }).dendrite({
                collateral: entry,
                response: (_payload, axon) => axon.placed.createSignal({ orderId: '42' }),
            });
            const cns = new CNS([orders]);
            const registry = new CNSPersistOptionsRegistry();
            registry.register('orders', orders).registerCollateral('orderEntered', entry);
            const stimulationRepository = new CNSInMemoryStimulationRepository();
            const admin = build({ stimulationRepository }, { cns, registry });
            await admin.fetch(new Request(`${origin}/__cnstra/poll?sessionId=s`, { method: 'DELETE' }));

            await cns
                .stimulate(entry.createSignal({ orderId: '42' }), { stimulationContext: { [CNS_JOB_IDENTITY_CONTEXT_KEY]: { stimulationId: 'job-1', attemptNumber: 2 } } })
                .waitUntilComplete();
            await new Promise(resolve => setTimeout(resolve, 50));

            expect((await stimulationRepository.listStimulations()).map(stimulation => stimulation.stimulationId)).toEqual(['job-1']);
            const attempts = await stimulationRepository.getAttempts('job-1');
            expect(attempts.map(attempt => attempt.attemptNumber)).toEqual([2]);
            expect(await stimulationRepository.getTasks(attempts[0].stimulationAttemptId)).toHaveLength(1);
        });

        it('takes the broker link a worker offers', async () => {
            const ran: string[] = [];
            const from: TCNSDevToolsSource = { ...source(), actions: () => async action => void ran.push(action.type) };
            const admin = build({}, from);
            const poll = `${origin}/__cnstra/poll?sessionId=panel-1`;

            await admin.fetch(
                new Request(poll, {
                    method: 'POST',
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ type: 'stimulation.launch', requestId: 'request-1', entry: { collateralName: 'orderPlaced', payload: {} } }),
                })
            );
            expect(ran).toEqual(['launch']);
        });
    });

    describe('the WebSocket', () => {
        const connect = (url: string): Promise<{ opened: boolean; status?: number; socket: WebSocket }> =>
            new Promise(resolve => {
                const socket = new WebSocket(url);
                socket.on('open', () => resolve({ opened: true, socket }));
                socket.on('unexpected-response', (_request, response) => resolve({ opened: false, status: response.statusCode, socket }));
                socket.on('error', () => resolve({ opened: false, socket }));
            });

        const serve = async (admin: TCNSDevToolsHandler) => {
            const { server, url } = await listen((request, response) => void admin.node(request, response));
            server.on('upgrade', (request, socket, head) => {
                void admin.upgrade(request, socket, head).then(handled => {
                    if (!handled) socket.destroy();
                });
            });
            return url.replace(/^http/, 'ws');
        };

        it('accepts no upgrade without authorizeUpgrade', async () => {
            const url = await serve(build({ basePath: '/admin/cnstra' }));
            const { opened, status } = await connect(`${url}/admin/cnstra`);
            expect(opened).toBe(false);
            expect(status).toBe(401);
        });

        it('accepts an upgrade authorizeUpgrade allows, and speaks the protocol over it', async () => {
            const url = await serve(build({ basePath: '/admin/cnstra', webSocket: { authorizeUpgrade: request => request.headers['x-admin'] === 'yes' } }));

            expect((await connect(`${url}/admin/cnstra`)).status).toBe(401);

            const { opened, socket } = await new Promise<{ opened: boolean; socket: WebSocket }>(resolve => {
                const authorized = new WebSocket(`${url}/admin/cnstra`, { headers: { 'x-admin': 'yes' } });
                authorized.on('open', () => resolve({ opened: true, socket: authorized }));
                authorized.on('error', () => resolve({ opened: false, socket: authorized }));
            });
            expect(opened).toBe(true);
            const reply = new Promise<string>(resolve => socket.once('message', data => resolve(data.toString())));
            socket.send(JSON.stringify({ type: 'client.connect' }));
            expect(JSON.parse(await reply).type).toBe('ui.config');
            socket.close();
        });

        it('never registers a WebSocket client as an app', async () => {
            const admin = build({ appId: 'orders', webSocket: { authorizeUpgrade: () => true } });
            const url = await serve(admin);
            const { socket } = await connect(`${url}/`);
            const topology = {
                type: 'batch',
                items: [{ type: 'topology', appId: 'intruder', cnsId: 'intruder:cns', appName: 'intruder', version: '1', timestamp: Date.now(), neurons: [], collaterals: [], dendrites: [] }],
            };
            socket.send(JSON.stringify(topology));
            await new Promise(resolve => setTimeout(resolve, 30));
            socket.close();

            expect(await appIdsOf(admin)).toEqual(['orders']);
        });

        it('leaves an upgrade outside basePath to someone else', async () => {
            const url = await serve(build({ basePath: '/admin/cnstra', webSocket: { authorizeUpgrade: () => true } }));
            expect((await connect(`${url}/elsewhere`)).opened).toBe(false);
        });
    });
});
