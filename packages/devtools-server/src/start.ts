import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';
import { CNSDevToolsServer } from './index';
import type { ICNS, TCNSNeuron, CNSPersistOptionsRegistry, CNSCollateral } from '@cnstra/core';

// createRequire from cwd works in both CJS (jest) and ESM (production)
const _require = createRequire(join(process.cwd(), 'package.json'));

// ─── Locate panel UI static files ────────────────────────────────────────────

function findPanelUIDir(): string | null {
    // Check if manually installed alongside devtools-server
    try {
        const pkg = _require.resolve('@cnstra/devtools-panel-ui/package.json');
        return join(dirname(pkg), 'dist');
    } catch {}
    // Monorepo fallback
    try {
        const here = dirname(_require.resolve('@cnstra/devtools-server/package.json'));
        const monorepoPath = join(here, '..', '..', 'devtools-panel-ui', 'dist');
        if (existsSync(join(monorepoPath, 'index.html'))) return monorepoPath;
    } catch {}
    return null;
}

// ─── Bridge: wrap CNS + registry into the shape devtools client expects ───────

function makeCNSAdapter(
    cns: ICNS<TCNSNeuron<any, any>>,
    registry: CNSPersistOptionsRegistry
) {
    return {
        addResponseListener: (l: (r: unknown) => void) => cns.addResponseListener(l as any),
        stimulate: (signal: unknown, opts: unknown) => cns.stimulate(signal as any, opts as any),
        getNeurons: () =>
            [...registry.getNamedNeurons().entries()].map(([name, n]) => ({
                name,
                axon:      n.axon,
                dendrites: n.dendrites,
            })),
        getCollaterals: () => {
            const out: Array<{ name: string; createSignal: (p: unknown) => unknown }> = [];
            for (const [, n] of registry.getNamedNeurons()) {
                for (const [key, col] of Object.entries(n.axon)) {
                    out.push({ name: key, createSignal: (p) => (col as CNSCollateral<unknown>).createSignal(p as any) });
                }
            }
            return out;
        },
    };
}

// ─── Static file handler ──────────────────────────────────────────────────────

const MIME: Record<string, string> = {
    html: 'text/html',
    js:   'application/javascript',
    css:  'text/css',
    svg:  'image/svg+xml',
    png:  'image/png',
    woff2:'font/woff2',
};

function serveStatic(panelUIDir: string) {
    return (_req: IncomingMessage, res: ServerResponse) => {
        const url  = _req.url ?? '/';
        const safe = url.split('?')[0].replace(/\.\./g, '');
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

// ─── Public API ───────────────────────────────────────────────────────────────

export type StartDevToolsOptions = {
    /** Port for both HTTP (UI) and WebSocket. Default: 3141 */
    port?: number;
    /** Automatically open browser. Default: true when running in a TTY */
    open?: boolean;
    /** App ID shown in DevTools. Default: 'app' */
    appId?: string;
    consoleLogEnabled?: boolean;
};

export type DevToolsHandle = {
    /** URL of the DevTools UI */
    url: string;
    /** Stop the server */
    stop: () => void;
};

/**
 * Starts the CNStra DevTools UI and connects your CNS instance to it.
 * HTTP + WebSocket on the same port — open the URL in a browser to debug.
 *
 * @example
 * // dev.ts  (excluded from prod entry point)
 * import { startDevTools } from '@cnstra/devtools-server';
 * import { cns } from './cns';
 * import { registry } from './neurons/registry';
 *
 * await startDevTools(cns, registry);
 * // → 🧠 CNStra DevTools: http://localhost:3141
 */
export async function startDevTools(
    cns: ICNS<TCNSNeuron<any, any>>,
    registry: CNSPersistOptionsRegistry,
    options: StartDevToolsOptions = {}
): Promise<DevToolsHandle> {
    const port    = options.port  ?? 3141;
    const appId   = options.appId ?? 'app';
    const logEnabled = options.consoleLogEnabled ?? false;
    const panelUIDir = findPanelUIDir();

    if (!panelUIDir) {
        console.warn(
            '\n⚠️  CNStra DevTools UI not found.\n' +
            '   WebSocket server will start but the UI will not be served.\n' +
            '   Install @cnstra/devtools-panel-ui or build it from the monorepo.\n'
        );
    }

    // HTTP + WebSocket on one port
    const httpServer = createServer(
        panelUIDir
            ? serveStatic(panelUIDir)
            : (_, res) => { res.writeHead(503); res.end('DevTools UI not available. See console for details.'); }
    );
    const wss        = new WebSocketServer({ server: httpServer });

    const { CNSDevToolsServerRepositoryInMemory } = await import(
        '@cnstra/devtools-server-repository-in-memory'
    );
    const dtServer = new CNSDevToolsServer(
        new CNSDevToolsServerRepositoryInMemory(),
        { consoleLogEnabled: logEnabled }
    );

    const clients = new Set<WebSocket>();

    wss.on('connection', (ws) => {
        clients.add(ws);
        ws.on('message', async (data) => {
            try {
                const msg    = JSON.parse(data.toString());
                const result = await dtServer.handleMessage(ws as any, msg);
                if (result) {
                    const payload = JSON.stringify(result);
                    clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
                }
            } catch {}
        });
        ws.on('close', () => {
            clients.delete(ws);
            dtServer.handleDisconnect(ws as any);
        });
    });

    await new Promise<void>((resolve) => httpServer.listen(port, resolve));

    const url = `http://localhost:${port}`;

    // Connect client in-process
    const { CNSDevTools } = await import('@cnstra/devtools');
    const { CNSDevToolsTransportWs } = await import('@cnstra/devtools-transport-ws');

    const transport = new CNSDevToolsTransportWs({
        url: `ws://localhost:${port}`,
    });
    const devtools = new CNSDevTools(appId, transport as any, {
        devToolsInstanceName: appId,
        consoleLogEnabled: logEnabled,
    });
    devtools.registerCNS(makeCNSAdapter(cns, registry) as any, 'main');

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
        stop: () => { wss.close(); httpServer.close(); },
    };
}
