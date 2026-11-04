import type { IncomingMessage } from 'http';
import { WebSocketServer } from 'ws';
import { CNS_DEVTOOLS_SYNC_PATH } from '@cnstra/devtools-dto';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import { CNSDevToolsServer } from './index';
import type { TCNSUiConfig } from './index';
import { CNSDevToolsPollingTransport } from './pollingTransport';
import { createCNSDevToolsServerRepositoryInMemory } from './createCNSDevToolsServerRepositoryInMemory';
import { CNSDevToolsInProcessTransport } from './CNSDevToolsInProcessTransport';
import { CNSDevToolsPanelPage } from './CNSDevToolsPanelPage';
import type { ICNSDevToolsClient } from './ICNSDevToolsClient';
import type { TCNSDevToolsHandler } from './TCNSDevToolsHandler';
import type { TCNSDevToolsHandlerOptions } from './TCNSDevToolsHandlerOptions';
import type { TCNSDevToolsHttpAnswer } from './TCNSDevToolsHttpAnswer';
import type { TCNSDevToolsHttpRequest } from './TCNSDevToolsHttpRequest';
import type { TCNSDevToolsSource } from './TCNSDevToolsSource';

const POLL_PATH = '/__cnstra/poll';

const answer = (status: number, body = ''): TCNSDevToolsHttpAnswer => ({
    status,
    headers: body ? { 'content-type': 'text/plain; charset=utf-8' } : {},
    body,
});

const textOf = (parsed: unknown): string => {
    if (typeof parsed === 'string') return parsed;
    if (parsed instanceof Uint8Array) return new TextDecoder().decode(parsed);
    return JSON.stringify(parsed);
};

const isJson = (contentType: string | undefined): boolean =>
    contentType?.split(';')[0].trim().toLowerCase() === 'application/json';

const readNodeBody = (request: IncomingMessage): Promise<string> => {
    if (request.readableEnded && 'body' in request) return Promise.resolve(textOf(request.body));
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => (body += chunk));
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
};

const pathOf = (request: IncomingMessage): string =>
    'originalUrl' in request && typeof request.originalUrl === 'string' ? request.originalUrl : request.url ?? '/';

export function createCNSDevToolsHandler(
    source: TCNSDevToolsSource,
    options: TCNSDevToolsHandlerOptions = {}
): TCNSDevToolsHandler {
    const basePath = (options.basePath ?? '/').replace(/\/+$/, '');
    const readOnly = options.readOnly ?? false;
    const webSocketAuthorization = options.webSocket?.authorizeUpgrade;
    const stimulationRepository =
        options.stimulationRepository ?? new CNSInMemoryStimulationRepository({ maxStimulations: 1000 });
    const ui: TCNSUiConfig = readOnly ? { ...options.ui, actions: { retry: false, clone: false } } : options.ui ?? {};
    const page = new CNSDevToolsPanelPage(CNSDevToolsPanelPage.locate(), {
        basePath: basePath || '/',
        transport: options.webSocket ? 'socket' : 'polling',
        readOnly,
    });
    const webSocketServer = new WebSocketServer({ noServer: true });

    const actions = readOnly ? [] : [...(options.actions ?? []), ...(source.actions ? [source.actions()] : [])];

    const ready = (async () => {
        const server = new CNSDevToolsServer(
            await createCNSDevToolsServerRepositoryInMemory(),
            stimulationRepository,
            actions,
            ui,
            options.scheduledStimulationReader,
            readOnly
        );
        const { CNSDevTools } = await import('@cnstra/devtools');
        const transport = new CNSDevToolsInProcessTransport(server);
        const appId = options.appId ?? 'app';
        const devtools = new CNSDevTools(appId, transport, { appName: appId });
        devtools.registerCNS(source.cns, source.registry);
        const polling = new CNSDevToolsPollingTransport(server, options.polling, 'viewer');
        return { server, transport, devtools, polling };
    })();
    ready.catch(error => console.error('[CNStra] the devtools handler failed to start', error));

    const relativePathOf = (pathname: string): string | undefined => {
        if (pathname === basePath) return '';
        return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
    };

    const poll = async (request: TCNSDevToolsHttpRequest): Promise<TCNSDevToolsHttpAnswer> => {
        const sessionId = request.url.searchParams.get('sessionId');
        if (!sessionId) return answer(400, 'sessionId required');
        const { polling } = await ready;
        if (request.method === 'POST') {
            if (!isJson(request.contentType)) return answer(415, 'content-type must be application/json');
            await polling.post(sessionId, await request.readBody());
            return answer(204);
        }
        if (request.method === 'DELETE') {
            polling.close(sessionId);
            return answer(204);
        }
        if (request.method !== 'GET') return answer(405);
        return {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
            body: JSON.stringify({ messages: await polling.poll(sessionId) }),
        };
    };

    const sync = async (request: TCNSDevToolsHttpRequest): Promise<TCNSDevToolsHttpAnswer> => {
        if (request.method !== 'GET') return answer(405);
        const { server } = await ready;
        return server.homeostatTransductionEndpoint.respond(request.url.search.replace(/^\?/, ''), request.accept);
    };

    const route = async (request: TCNSDevToolsHttpRequest): Promise<TCNSDevToolsHttpAnswer | undefined> => {
        const relativePath = relativePathOf(request.url.pathname);
        if (relativePath === undefined) return undefined;
        if (relativePath === POLL_PATH) return poll(request);
        if (relativePath === CNS_DEVTOOLS_SYNC_PATH) return sync(request);
        if (request.method !== 'GET') return undefined;
        if (relativePath === '' || relativePath === '/') return page.page();
        return page.file(relativePath);
    };

    return {
        async node(request, response, next) {
            let routed: TCNSDevToolsHttpAnswer | undefined;
            try {
                routed = await route({
                    method: request.method ?? 'GET',
                    url: new URL(pathOf(request), 'http://localhost'),
                    accept: request.headers.accept,
                    contentType: request.headers['content-type'],
                    readBody: () => readNodeBody(request),
                });
            } catch (error) {
                if (next) return next(error);
                routed = answer(500, 'Internal Server Error');
            }
            if (!routed) {
                if (next) return next();
                routed = answer(404, 'Not Found');
            }
            response.writeHead(routed.status, routed.headers);
            response.end(routed.body);
        },

        async fetch(request) {
            const routed =
                (await route({
                    method: request.method,
                    url: new URL(request.url),
                    accept: request.headers.get('accept') ?? undefined,
                    contentType: request.headers.get('content-type') ?? undefined,
                    readBody: () => request.text(),
                })) ?? answer(404, 'Not Found');
            return new Response(routed.body === '' ? null : routed.body, {
                status: routed.status,
                headers: routed.headers,
            });
        },

        async upgrade(request, socket, head) {
            const relativePath = relativePathOf(new URL(request.url ?? '/', 'http://localhost').pathname);
            if (relativePath !== '' && relativePath !== '/') return false;
            let authorized = false;
            try {
                authorized = webSocketAuthorization ? await webSocketAuthorization(request) : false;
            } catch {}
            if (!authorized) {
                socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                return true;
            }
            let server: CNSDevToolsServer;
            try {
                ({ server } = await ready);
            } catch {
                socket.destroy();
                return true;
            }
            webSocketServer.handleUpgrade(request, socket, head, webSocket => {
                const viewer: ICNSDevToolsClient = {
                    role: 'viewer',
                    send: data => webSocket.send(data),
                    get readyState() {
                        return webSocket.readyState;
                    },
                };
                webSocket.on('message', data => {
                    server.handleMessage(viewer, data.toString()).catch(() => undefined);
                });
                webSocket.on('close', () => server.removeClient(viewer));
            });
            return true;
        },

        async ready() {
            await ready;
        },

        async dispose() {
            for (const webSocket of webSocketServer.clients) webSocket.terminate();
            await new Promise<void>(resolve => webSocketServer.close(() => resolve()));
            const started = await ready.catch(() => undefined);
            if (!started) return;
            started.devtools.destroy();
            started.transport.close();
            started.polling.dispose();
        },
    };
}
