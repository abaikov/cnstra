/**
 * One-button broker demo: brings the container UP, runs the retry-admin, and on
 * Ctrl+C shuts everything down — no separate stop/teardown command needed.
 *
 *   ADMIN_QUEUE=pgboss tsx src/admin/demo.ts   → docker compose up postgres → admin → down
 *   ADMIN_QUEUE=bull   tsx src/admin/demo.ts   → docker compose up redis    → admin → down
 *
 * If Docker isn't available (or DOCKER=0), it skips container management and
 * assumes you already have the broker running (point DATABASE_URL / REDIS_* at it).
 * Shutdown order on SIGINT/SIGTERM: graceful admin stop (checkpoint in-flight +
 * close broker connection) FIRST, then `docker compose down` — so the checkpoint
 * is written before the database goes away.
 */
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { startAdmin } from './create-admin-server';

const queueKind = process.env.ADMIN_QUEUE;
const svc =
    queueKind === 'pgboss' ? 'postgres' : queueKind === 'bull' ? 'redis' : null;
const svcPort = svc === 'postgres' ? 5432 : svc === 'redis' ? 6379 : 0;
const composeCwd = join(__dirname, '..', '..'); // packages/examples

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
            cwd: composeCwd,
            stdio: 'inherit',
        });
        if (up.status === 0) {
            broughtUp = true;
            log(`  ⏳ waiting for ${svc} on :${svcPort} …`);
            if (!(await waitForPort(svcPort, 30000)))
                log(`  ⚠️  ${svc} did not become reachable — starting admin anyway`);
        } else {
            log('  ⚠️  docker compose up failed — assuming an existing broker');
        }
    } else if (svc) {
        log(`  ℹ️  Docker not used — expecting an existing ${svc} (DATABASE_URL / REDIS_*).`);
    }

    const admin = await startAdmin();
    log(`\n  🖥️  CNStra retry-admin → http://localhost:${admin.port}`);
    log(`     backend: ${admin.backend}\n`);
    log('     Launch a task, watch it FAIL, then Retry (resume) or Clone.');
    log('     Ctrl+C = graceful shutdown + container teardown (no extra command).\n');

    let stopping = false;
    const shutdown = async (sig: string): Promise<void> => {
        if (stopping) return;
        stopping = true;
        log(`\n  ${sig} — graceful shutdown…`);
        await admin.stop(); // checkpoint in-flight + close broker BEFORE the DB dies
        log('  ✓ admin stopped cleanly.');
        if (broughtUp) {
            log(`  🐳 docker compose down -v …`);
            spawnSync('docker', ['compose', 'down', '-v'], {
                cwd: composeCwd,
                stdio: 'inherit',
            });
        }
        log('  ✓ done.');
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch(e => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
});
