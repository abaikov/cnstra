/**
 * Reusable, transport-thin HTTP handler for the resumable-runs admin.
 *
 * The admin is a POLLING surface, not a push one: resumable runs change on a button
 * press (launch / retry / clone), not in a stream, so a client just re-reads
 * `GET /api/stimulations` on an interval — no socket needed. This factors the routes out
 * of the standalone server so the SAME endpoints can be mounted anywhere (the
 * examples server here; devtools-server later) and read by any client — the panel
 * page, the standalone HTML, curl. CORS is open so a panel on another origin can
 * poll it.
 *
 *   GET  /api/info          → { backend }
 *   GET  /api/stimulations          → TStimulationSummary[]        (poll this)
 *   POST /api/launch {fail} → { stimulationId }
 *   POST /api/retry  {stimulationId}→ { ok }
 *   POST /api/clone  {stimulationId}→ { stimulationId }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StimulationRunManager } from './stimulation-manager';

const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise(resolve => {
        let data = '';
        req.on('data', c => (data += c));
        req.on('end', () => resolve(data));
    });

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
};

const json = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
};

export function createStimulationsHandler(
    manager: StimulationRunManager,
    opts: { backend: string; store?: string }
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const p = url.pathname;
        if (!p.startsWith('/api/')) return false;

        if (req.method === 'OPTIONS') {
            res.writeHead(204, CORS);
            res.end();
            return true;
        }
        if (req.method === 'GET' && p === '/api/info') {
            json(res, 200, { backend: opts.backend, store: opts.store ?? 'in-memory' });
            return true;
        }
        if (req.method === 'GET' && p === '/api/stimulations') {
            json(res, 200, await manager.snapshot());
            return true;
        }
        if (req.method === 'POST' && p === '/api/launch') {
            const b = JSON.parse((await readBody(req)) || '{}');
            const userId = String(
                b.userId ?? Math.floor(1000 + Math.random() * 9000)
            );
            const fail = b.fail !== false; // default: demonstrate a failure
            json(res, 200, { stimulationId: await manager.launch({ userId, fail }) });
            return true;
        }
        if (req.method === 'POST' && p === '/api/retry') {
            const b = JSON.parse((await readBody(req)) || '{}');
            if (!b.stimulationId) return json(res, 400, { error: 'stimulationId required' }), true;
            await manager.retry(String(b.stimulationId));
            json(res, 200, { ok: true });
            return true;
        }
        if (req.method === 'POST' && p === '/api/clone') {
            const b = JSON.parse((await readBody(req)) || '{}');
            if (!b.stimulationId) return json(res, 400, { error: 'stimulationId required' }), true;
            json(res, 200, { stimulationId: await manager.clone(String(b.stimulationId)) });
            return true;
        }
        return false;
    };
}
