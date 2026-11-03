import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';
import { CNSDevToolsServer } from './index';
import { createCNSDevToolsServerRepositoryInMemory } from './createCNSDevToolsServerRepositoryInMemory';
import { CNSDevToolsPollingTransport } from './pollingTransport';
import type { TCNSPollingOptions } from './pollingTransport';
import type { TCNSUiConfig } from './index';
import type { ICNSScheduledStimulationReader, TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import type {
    CNSPersistOptionsRegistry,
    ICNSStimulationRepository,
} from '@cnstra/persist';
import type { ICNS, TCNSNeuron } from '@cnstra/types';

const _require = createRequire(join(process.cwd(), 'package.json'));

function findPanelUIDir(): string | null {
    try {
        const pkg = _require.resolve('@cnstra/devtools-panel-ui/package.json');
        return join(dirname(pkg), 'dist');
    } catch {}
    try {
        const here = dirname(_require.resolve('@cnstra/devtools-server/package.json'));
        const monorepoPath = join(here, '..', '..', 'devtools-panel-ui', 'dist');
        if (existsSync(join(monorepoPath, 'index.html'))) return monorepoPath;
    } catch {}
    return null;
}

const MIME: Record<string, string> = {
    html: 'text/html', js: 'application/javascript', css: 'text/css',
    svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2',
};

function serveStatic(panelUIDir: string) {
    return (_req: IncomingMessage, res: ServerResponse) => {
        const safe = (_req.url ?? '/').split('?')[0].replace(/\.\./g, '');
        const file = safe === '/' ? '/index.html' : safe;
        const full = join(panelUIDir, file);

        if (existsSync(full) && full.startsWith(panelUIDir)) {
            const ext = full.split('.').pop() ?? '';
            res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'text/plain' });
            res.end(readFileSync(full));
        } else {
            const idx = join(panelUIDir, 'index.html');
            if (existsSync(idx)) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(readFileSync(idx));
            } else {
                res.writeHead(503);
                res.end('DevTools UI not built. Run: npm run build --workspace=@cnstra/devtools-panel-ui');
            }
        }
    };
}

export type TCNSDevToolsStartOptions = {
    /** Port for HTTP (UI) and WebSocket. Default: 3141 */
    port?: number;
    /**
     * Links that carry out a panel action (Retry / Clone), in order.
     *
     * Without one, an action is forwarded over the app's socket — which reaches
     * every connected replica of the same `appId`, so one Retry click runs on all
     * of them. Pass `createCNSBullActions(queue)` (or the pg-boss equivalent) and the
     * retry goes through the broker instead, where delivery and de-duplication are
     * its problem. The socket link is always appended last, so a run that came
     * from somewhere else still reaches an in-process CNS.
     */
    actions?: readonly TCNSDevToolsActionMiddleware[];
    /**
     * What the panel may offer. `{ actions: { retry: false } }` hides Retry — for
     * a deployment where a run's record must never be overwritten in place, so a
     * rerun has to go through Clone.
     */
    ui?: TCNSUiConfig;
    /**
     * Tuning for the HTTP polling fallback (always available at
     * `/__cnstra/poll`). The socket stays the default; polling is what a client
     * picks when an upgrade will not survive the network in between.
     */
    polling?: TCNSPollingOptions;
    /** Automatically open browser. Default: true in TTY */
    open?: boolean;
    /** App ID shown in DevTools. Default: 'app' */
    appId?: string;
    consoleLogEnabled?: boolean;
    /**
     * The canonical name-based Stimulation → Attempt → Task store the Explorer
     * reads its runs / facets / waterfall from. Pass the SAME instance you give a
     * pg-boss / BullMQ worker as its `observe` store, and every job run shows up
     * in the Explorer live (one process, shared memory). Use a
     * `CNSPostgresStimulationRepository` to keep history across restarts, or omit
     * for a fresh ephemeral in-memory store.
     */
    stimulationRepository?: ICNSStimulationRepository;
    scheduledStimulationReader?: ICNSScheduledStimulationReader;
};

export type TCNSDevToolsHandle = {
    url: string;
    stop: () => void;
};

/**
 * Starts the CNStra DevTools UI and connects your CNS instance to it.
 *
 * @example
 * import { startCNSDevTools } from '@cnstra/devtools-server';
 * import { cns } from './cns';
 * import { registry } from './neurons/registry';
 *
 * await startCNSDevTools(cns, registry);
 * // → 🧠 CNStra DevTools: http://localhost:3141
 */
export async function startCNSDevTools(
    cns: ICNS<TCNSNeuron<any>>,
    registry: CNSPersistOptionsRegistry,
    options: TCNSDevToolsStartOptions = {}
): Promise<TCNSDevToolsHandle> {
    const port = options.port ?? 3141;
    const appId = options.appId ?? 'app';
    const logEnabled = options.consoleLogEnabled ?? false;
    const panelUIDir = findPanelUIDir();

    if (!panelUIDir) {
        console.warn(
            '\n⚠️  CNStra DevTools UI not found.\n' +
            '   WebSocket server will start but the UI will not be served.\n' +
            '   Install @cnstra/devtools-panel-ui or build it from the monorepo.\n'
        );
    }

    const dtServer = new CNSDevToolsServer(
        await createCNSDevToolsServerRepositoryInMemory(),
        options.stimulationRepository,
        options.actions,
        options.ui,
        options.scheduledStimulationReader
    );
    const polling = new CNSDevToolsPollingTransport(dtServer, options.polling);

    const staticHandler = panelUIDir
        ? serveStatic(panelUIDir)
        : (_: IncomingMessage, res: ServerResponse) => {
              res.writeHead(503);
              res.end('DevTools UI not available.');
          };

    const readBody = (req: IncomingMessage): Promise<string> =>
        new Promise(resolve => {
            let body = '';
            req.on('data', chunk => (body += chunk));
            req.on('end', () => resolve(body));
        });

    const httpServer = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
            // Polling endpoints first: the same protocol for a network that will
            // not carry a WebSocket upgrade. The socket stays the default — this
            // is only reached by a client that asked for it.
            if (req.url?.startsWith('/__cnstra/poll')) {
                // A WebSocket is not subject to CORS; polling is. Without these
                // headers the fallback fails exactly where it is needed — a panel
                // loaded from file:// (electron) or another origin could use the
                // socket and not the thing that exists for when the socket cannot
                // get through. Nothing is loosened: this server has no auth and
                // already serves the panel to whoever can reach it.
                res.setHeader('access-control-allow-origin', '*');
                res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
                res.setHeader('access-control-allow-headers', 'content-type');
                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    return res.end();
                }

                const url = new URL(req.url, 'http://localhost');
                const sessionId = url.searchParams.get('sessionId');
                if (!sessionId) {
                    res.writeHead(400);
                    return res.end('sessionId required');
                }

                if (req.method === 'POST') {
                    const body = await readBody(req);
                    await polling.post(sessionId, body);
                    res.writeHead(204);
                    return res.end();
                }
                if (req.method === 'DELETE') {
                    polling.close(sessionId);
                    res.writeHead(204);
                    return res.end();
                }
                const messages = await polling.poll(sessionId);
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ messages }));
            }

            return staticHandler(req, res);
        }
    );
    const wss = new WebSocketServer({ server: httpServer });


    wss.on('connection', (ws) => {
        ws.on('message', async (data) => {
            try {
                await dtServer.handleMessage(ws as any, data.toString());
            } catch {}
        });
        ws.on('close', () => dtServer.removeClient(ws as any));
    });

    await new Promise<void>((resolve) => httpServer.listen(port, resolve));

    const url = `http://localhost:${port}`;

    const { CNSDevTools } = await import('@cnstra/devtools');
    const { CNSDevToolsTransportWs } = await import('@cnstra/devtools-transport-ws');

    const transport = new CNSDevToolsTransportWs({ url: `ws://localhost:${port}` });
    const devtools = new CNSDevTools(appId, transport, {
        appName: appId,
        consoleLogEnabled: logEnabled,
    });
    devtools.registerCNS(cns, registry);

    if (logEnabled || process.stdout.isTTY) {
        console.log(`\n🧠 CNStra DevTools: ${url}\n`);
    }

    const shouldOpen = options.open ?? process.stdout.isTTY;
    if (shouldOpen) {
        const { exec } = await import('child_process');
        const cmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32'  ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`);
    }

    return {
        url,
        stop: () => { dtServer.stop(); wss.close(); httpServer.close(); },
    };
}
