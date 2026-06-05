import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';
import { CNSDevToolsServer } from './index';
import type { ICNS, TCNSNeuron, CNSPersistOptionsRegistry } from '@cnstra/core';

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

export type StartDevToolsOptions = {
    /** Port for HTTP (UI) and WebSocket. Default: 3141 */
    port?: number;
    /** Automatically open browser. Default: true in TTY */
    open?: boolean;
    /** App ID shown in DevTools. Default: 'app' */
    appId?: string;
    consoleLogEnabled?: boolean;
};

export type DevToolsHandle = {
    url: string;
    stop: () => void;
};

/**
 * Starts the CNStra DevTools UI and connects your CNS instance to it.
 *
 * @example
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

    const httpServer = createServer(
        panelUIDir
            ? serveStatic(panelUIDir)
            : (_, res) => { res.writeHead(503); res.end('DevTools UI not available.'); }
    );
    const wss = new WebSocketServer({ server: httpServer });

    const { CNSDevToolsServerRepositoryInMemory } = await import(
        '@cnstra/devtools-server-repository-in-memory'
    );
    const dtServer = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory());

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
