import { createServer } from 'http';
import type { Server } from 'http';
import { createCNSDevToolsHandler } from './createCNSDevToolsHandler';
import type { TCNSDevToolsHandler } from './TCNSDevToolsHandler';
import type { TCNSDevToolsHandlerOptions } from './TCNSDevToolsHandlerOptions';
import type { TCNSDevToolsSource } from './TCNSDevToolsSource';
import { CNSDevToolsLocalRequestPolicy } from './CNSDevToolsLocalRequestPolicy';

export type TCNSDevToolsStartOptions = Omit<TCNSDevToolsHandlerOptions, 'basePath'> & {
    /** Port for HTTP (UI) and WebSocket. Default: 3141 */
    port?: number;
    host?: string;
    /** Automatically open browser. Default: true in TTY */
    open?: boolean;
    consoleLogEnabled?: boolean;
};

export type TCNSDevToolsHandle = {
    url: string;
    stop: () => void;
    admin: TCNSDevToolsHandler;
};

const listenOn = (server: Server, port: number, host: string): Promise<number> =>
    new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            const address = server.address();
            resolve(typeof address === 'object' && address ? address.port : port);
        });
    });

/**
 * Starts the CNStra DevTools UI and connects your CNS instance to it.
 *
 * @example
 * import { startCNSDevTools } from '@cnstra/devtools-server';
 *
 * await startCNSDevTools(worker);
 * // → 🧠 CNStra DevTools: http://127.0.0.1:3141
 */
export async function startCNSDevTools(
    source: TCNSDevToolsSource,
    options: TCNSDevToolsStartOptions = {}
): Promise<TCNSDevToolsHandle> {
    const { port = 3141, host = '127.0.0.1', open, consoleLogEnabled, webSocket, ...handlerOptions } = options;
    let listeningPort = port;
    const admin = createCNSDevToolsHandler(source, {
        ...handlerOptions,
        ...(webSocket
            ? { webSocket: { authorizeUpgrade: webSocket.authorizeUpgrade ?? (request => CNSDevToolsLocalRequestPolicy.isLocalUpgrade(request, listeningPort)) } }
            : {}),
    });
    try {
        await admin.ready();
    } catch (error) {
        await admin.dispose();
        throw error;
    }

    const isBoundToLoopback = CNSDevToolsLocalRequestPolicy.isLoopbackBind(host);
    const httpServer = createServer((request, response) => {
        if (isBoundToLoopback && !CNSDevToolsLocalRequestPolicy.isLoopbackHost(request.headers.host, listeningPort)) {
            response.writeHead(403);
            response.end();
            return;
        }
        void admin.node(request, response);
    });
    httpServer.on('upgrade', (request, socket, head) => {
        void admin.upgrade(request, socket, head).then(handled => {
            if (!handled) socket.destroy();
        });
    });

    try {
        listeningPort = await listenOn(httpServer, port, host);
    } catch (error) {
        await admin.dispose();
        throw error;
    }

    const url = `http://${host.includes(':') ? `[${host}]` : host}:${listeningPort}`;

    if (consoleLogEnabled || process.stdout.isTTY) {
        console.log(`\n🧠 CNStra DevTools: ${url}\n`);
    }

    if (open ?? process.stdout.isTTY) {
        const { exec } = await import('child_process');
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${command} ${url}`);
    }

    return {
        url,
        stop: () => {
            void admin.dispose();
            httpServer.close();
        },
        admin,
    };
}
