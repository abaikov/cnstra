/**
 * Builds and starts the retry-admin HTTP server, returning a `stop()` for a
 * graceful shutdown. Extracted from server.ts so both the plain entry and the
 * container-managing demo orchestrator share one lifecycle.
 *
 * `stop()` does the shutdown "properly": it first aborts any in-flight
 * stimulation (via the manager) so its frontier is checkpointed by the persistor,
 * THEN stops accepting connections, THEN closes the broker transport. Order
 * matters — checkpoint before the queue/DB connection goes away.
 */
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DurableRunManager } from './run-manager';
import { attachBullTransport } from './bull-transport';
import { attachPgBossTransport } from './pgboss-transport';
import { createDurableRunsHandler } from './durable-http-handler';
import { createRunStore } from './run-store';

export type TAdminHandle = { port: number; backend: string; store: string; stop: () => Promise<void> };

export async function startAdmin(): Promise<TAdminHandle> {
    const port = Number(process.env.PORT ?? 4545);
    const queueKind = process.env.ADMIN_QUEUE; // 'bull' | 'pgboss' | undefined
    const backend =
        queueKind === 'bull'
            ? 'bullmq (redis)'
            : queueKind === 'pgboss'
              ? 'pg-boss (postgres)'
              : 'in-process';

    // The run/attempt/task HISTORY store (domain #2): in-memory by default, or a
    // durable Postgres store when ADMIN_STORE=postgres (survives a restart).
    const { repository, store, closeStore } = createRunStore();
    const manager = new DurableRunManager(repository);
    const apiHandler = createDurableRunsHandler(manager, { backend, store });
    const clients = new Set<ServerResponse>();
    manager.onChange(() => {
        for (const res of clients) res.write('event: update\ndata: 1\n\n');
    });

    const server: Server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);
        try {
            if (req.method === 'GET' && url.pathname === '/') {
                const html = await readFile(join(__dirname, 'index.html'), 'utf8');
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(html);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/fonts/Px437_IBM_Conv.ttf') {
                const font = await readFile(join(__dirname, 'fonts', 'Px437_IBM_Conv.ttf'));
                res.writeHead(200, { 'content-type': 'font/ttf' });
                res.end(font);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/events') {
                res.writeHead(200, {
                    'content-type': 'text/event-stream',
                    'cache-control': 'no-cache',
                    connection: 'keep-alive',
                });
                res.write('event: update\ndata: 1\n\n');
                clients.add(res);
                req.on('close', () => clients.delete(res));
                return;
            }
            if (await apiHandler(req, res)) return;
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
        } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: (e as Error).message }));
        }
    });

    let transport: { close: () => Promise<void> } | undefined;
    if (queueKind === 'bull') transport = await attachBullTransport(manager);
    else if (queueKind === 'pgboss')
        transport = await attachPgBossTransport(manager);

    await new Promise<void>(resolve => server.listen(port, resolve));
    // Seed one failing run ONLY when the store is empty — so a durable (Postgres)
    // store shows the runs it already had after a restart instead of piling on.
    if ((await manager.snapshot()).length === 0)
        void manager.launch({ userId: '42', fail: true });

    const stop = async (): Promise<void> => {
        // 1) abort in-flight → the persistor checkpoints the outstanding frontier
        await manager.shutdown();
        // 2) stop accepting new connections
        for (const res of clients) res.end();
        await new Promise<void>(resolve => server.close(() => resolve()));
        // 3) close the broker connection (worker.close() / boss.stop())
        if (transport) await transport.close();
        // 4) close the run store (Postgres pool, if any)
        await closeStore();
    };

    return { port, backend, store, stop };
}
