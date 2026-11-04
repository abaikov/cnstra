#!/usr/bin/env node
/**
 * npx @cnstra/devtools-server
 *
 * Starts a standalone DevTools server. Your app connects via WebSocket.
 * Open the printed URL in a browser to see the DevTools UI.
 */

import { createServer } from 'http';
import type { IncomingMessage } from 'http';
import { WebSocketServer } from 'ws';
import { CNS_DEVTOOLS_SYNC_PATH } from '@cnstra/devtools-dto';
import { CNSDevToolsServer } from './index';
import { createCNSDevToolsServerRepositoryInMemory } from './createCNSDevToolsServerRepositoryInMemory';
import { CNSDevToolsPanelPage } from './CNSDevToolsPanelPage';
import { CNSDevToolsLocalRequestPolicy } from './CNSDevToolsLocalRequestPolicy';

const port = Number(process.env.PORT ?? process.argv[2] ?? 3141);
const host = process.env.HOST ?? '127.0.0.1';
const isBoundToLoopback = CNSDevToolsLocalRequestPolicy.isLoopbackBind(host);
const trustedOrigins = (process.env.CNSTRA_DEVTOOLS_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
const page = new CNSDevToolsPanelPage(CNSDevToolsPanelPage.locate(), { basePath: '/', transport: 'socket', readOnly: false });

const dtServer = new CNSDevToolsServer(await createCNSDevToolsServerRepositoryInMemory());

const httpServer = createServer(async (req, res) => {
    if (isBoundToLoopback && !CNSDevToolsLocalRequestPolicy.isLoopbackHost(req.headers.host, port)) {
        res.writeHead(403);
        return res.end();
    }
    if (req.url?.startsWith(CNS_DEVTOOLS_SYNC_PATH)) {
        if (req.method !== 'GET') {
            res.writeHead(405);
            return res.end();
        }
        const answer = await dtServer.homeostatTransductionEndpoint.respond(
            req.url.slice(CNS_DEVTOOLS_SYNC_PATH.length).replace(/^\?/, ''),
            req.headers.accept
        );
        res.writeHead(answer.status, answer.headers);
        return res.end(answer.body);
    }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const answer =
        req.method !== 'GET'
            ? undefined
            : pathname === '/'
              ? await page.page()
              : await page.file(pathname);
    if (!answer) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    res.writeHead(answer.status, answer.headers);
    res.end(answer.body);
});

const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }: { req: IncomingMessage }) =>
        isBoundToLoopback ? CNSDevToolsLocalRequestPolicy.isLocalUpgrade(req, port, trustedOrigins) : CNSDevToolsLocalRequestPolicy.isSameOriginUpgrade(req, trustedOrigins),
});

wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
        try {
            await dtServer.handleMessage(ws, data.toString());
        } catch {}
    });
    ws.on('close', () => dtServer.removeClient(ws));
});

httpServer.listen(port, host, () => {
    console.log(`\n🧠 CNStra DevTools`);
    console.log(`   UI:        http://${host}:${port}`);
    console.log(`   WebSocket: ws://${host}:${port}`);
    console.log(`\n   In your app: new CNSDevToolsTransportWs({ url: 'ws://${host}:${port}' })\n`);
});
