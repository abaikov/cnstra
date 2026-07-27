/**
 * ONE-BUTTON full demo: the retry-admin over a REAL broker + the actual CNStra
 * DevTools panel, wired together. Run one command, open one URL:
 *
 *   ADMIN_QUEUE=bull   tsx src/admin/panel-demo.ts   → BullMQ (Redis)
 *   ADMIN_QUEUE=pgboss tsx src/admin/panel-demo.ts   → pg-boss (Postgres)
 *
 * It starts:
 *   • the retry-admin on :4545 — the durable run/attempt/task store, executed
 *     through the chosen broker (Launch / Retry-resume / Clone). Serves /api/runs.
 *   • example-app on :8080 — serves the DevTools **panel** and its own devtools
 *     WS server (topology + the name-based ⚡ Stimulations stream).
 *
 * Open http://localhost:8080:
 *   • 💀 Durable Runs → the broker-backed runs from :4545 (the panel polls it by
 *     default) — Launch a run, watch it fail, Retry to resume the frontier.
 *   • ⚡ Stimulations → example-app's own e-commerce CNS, live (name-based).
 *
 * If Docker is available it brings the broker container up and tears it down on
 * Ctrl+C; otherwise it expects an existing broker (DATABASE_URL / REDIS_*).
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { startAdmin } from './create-admin-server';

const queueKind = process.env.ADMIN_QUEUE;
const svc =
    queueKind === 'pgboss' ? 'postgres' : queueKind === 'bull' ? 'redis' : null;
const svcPort = svc === 'postgres' ? 5432 : svc === 'redis' ? 6379 : 0;
const examplesDir = join(__dirname, '..', '..'); // packages/examples
const exampleAppDir = join(examplesDir, '..', 'example-app');
const PANEL_PORT = Number(process.env.PANEL_PORT ?? 8080);

const log = (s: string): void => console.log(s); // eslint-disable-line no-console

const dockerAvailable = (): boolean =>
    process.env.DOCKER !== '0' &&
    spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const waitForPort = (port: number, timeoutMs: number): Promise<boolean> =>
    new Promise(resolve => {
        const started = Date.now();
        const tick = (): void => {
            const sock = connect(port, '127.0.0.1');
            sock.once('connect', () => {
                sock.destroy();
                resolve(true);
            });
            sock.once('error', () => {
                sock.destroy();
                if (Date.now() - started > timeoutMs) resolve(false);
                else setTimeout(tick, 500);
            });
        };
        tick();
    });

async function main(): Promise<void> {
    let broughtUp = false;

    if (svc && dockerAvailable()) {
        log(`  🐳 docker compose up -d ${svc} …`);
        const up = spawnSync('docker', ['compose', 'up', '-d', svc], {
            cwd: examplesDir,
            stdio: 'inherit',
        });
        if (up.status === 0) {
            broughtUp = true;
            log(`  ⏳ waiting for ${svc} on :${svcPort} …`);
            if (!(await waitForPort(svcPort, 30000)))
                log(`  ⚠️  ${svc} did not become reachable — starting anyway`);
        } else {
            log('  ⚠️  docker compose up failed — assuming an existing broker');
        }
    } else if (svc) {
        log(`  ℹ️  Docker not used — expecting an existing ${svc} (DATABASE_URL / REDIS_*).`);
    }

    // 1) the broker-backed retry-admin (durable run store + /api/runs) on :4545
    const admin = await startAdmin();
    log(`  🖥️  retry-admin (${admin.backend}) → http://localhost:${admin.port}`);

    // 2) the DevTools panel + WS server (example-app) on :8080. Its `start` script
    //    builds the panel UI (ensure:ui) and compiles before running.
    log(`  🧩 building + starting the DevTools panel on :${PANEL_PORT} …`);
    const panel: ChildProcess = spawn('npm', ['run', 'start'], {
        cwd: exampleAppDir,
        stdio: 'inherit',
        env: { ...process.env, PORT: String(PANEL_PORT) },
    });

    const ready = await waitForPort(PANEL_PORT, 120000);
    log('');
    if (ready) {
        log(`  ✅ Open  http://localhost:${PANEL_PORT}`);
        log(`     💀 Durable Runs → broker-backed runs (${admin.backend}) — Launch, then Retry/Clone`);
        log(`     ⚡ Stimulations → example-app's own CNS, live (name-based)`);
    } else {
        log(`  ⚠️  panel did not come up on :${PANEL_PORT} within 120s (check output above)`);
    }
    log('\n     Ctrl+C = graceful shutdown of everything.\n');

    let stopping = false;
    const shutdown = async (sig: string): Promise<void> => {
        if (stopping) return;
        stopping = true;
        log(`\n  ${sig} — graceful shutdown…`);
        panel.kill('SIGTERM');
        await admin.stop(); // checkpoint in-flight + close broker BEFORE the DB dies
        log('  ✓ admin stopped cleanly.');
        if (broughtUp) {
            log(`  🐳 docker compose down -v …`);
            spawnSync('docker', ['compose', 'down', '-v'], {
                cwd: examplesDir,
                stdio: 'inherit',
            });
        }
        log('  ✓ done.');
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    panel.on('exit', code => {
        if (!stopping) {
            log(`  ⚠️  panel process exited (code ${code}) — shutting down.`);
            void shutdown('panel-exit');
        }
    });
}

void main().catch(e => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
});
