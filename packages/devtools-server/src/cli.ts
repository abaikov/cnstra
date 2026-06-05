#!/usr/bin/env node
/**
 * npx @cnstra/devtools-server
 *
 * Starts a standalone DevTools server. Your app connects via WebSocket.
 * Open the printed URL in a browser to see the DevTools UI.
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';
import { CNSDevToolsServer } from './index';

const _require = createRequire(join(process.cwd(), 'package.json'));

function findPanelUIDir(): string {
    try {
        const pkg = _require.resolve('@cnstra/devtools-panel-ui/package.json');
        return join(dirname(pkg), 'dist');
    } catch {
        const here = dirname(_require.resolve('@cnstra/devtools-server/package.json'));
        return join(here, '..', '..', 'devtools-panel-ui', 'dist');
    }
}

const MIME: Record<string, string> = {
    html: 'text/html', js: 'application/javascript', css: 'text/css',
    svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2',
};

const port = Number(process.env.PORT ?? process.argv[2] ?? 3141);
const panelUIDir = findPanelUIDir();

const httpServer = createServer((req, res) => {
    const safe = (req.url ?? '/').split('?')[0].replace(/\.\./g, '');
    const file = safe === '/' ? '/index.html' : safe;
    const full = join(panelUIDir, file);

    if (existsSync(full) && full.startsWith(panelUIDir)) {
        const ext = full.split('.').pop() ?? '';
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'text/plain' });
        res.end(readFileSync(full));
    } else {
        const idx = join(panelUIDir, 'index.html');
        res.writeHead(existsSync(idx) ? 200 : 503, { 'Content-Type': 'text/html' });
        res.end(existsSync(idx) ? readFileSync(idx) : 'UI not built.');
    }
});

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

httpServer.listen(port, () => {
    console.log(`\n🧠 CNStra DevTools`);
    console.log(`   UI:        http://localhost:${port}`);
    console.log(`   WebSocket: ws://localhost:${port}`);
    console.log(`\n   In your app: new CNSDevToolsTransportWs({ url: 'ws://localhost:${port}' })\n`);
});
