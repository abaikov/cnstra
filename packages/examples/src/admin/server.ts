/**
 * The CNStra retry-admin server (no container management).
 *
 *   npm run demo:admin                  → in-process (no infra)
 *   ADMIN_QUEUE=bull|pgboss ...          → over a real broker you started yourself
 *
 * On Ctrl+C (SIGINT/SIGTERM) it shuts down GRACEFULLY: aborts any in-flight
 * stimulation so its frontier is checkpointed, closes the HTTP server, then closes
 * the broker connection. The container-managing one-button variant is demo.ts.
 */
import { startAdmin } from './create-admin-server';

async function main(): Promise<void> {
    const admin = await startAdmin();
    // eslint-disable-next-line no-console
    console.log(`\n  🖥️  CNStra retry-admin → http://localhost:${admin.port}`);
    console.log(`     backend: ${admin.backend} · store: ${admin.store}\n`);
    console.log('     Launch a task, watch it FAIL, then Retry (resume) or Clone.');
    console.log('     Ctrl+C = graceful shutdown (checkpoint in-flight, close broker).\n');

    let stopping = false;
    const shutdown = async (sig: string): Promise<void> => {
        if (stopping) return;
        stopping = true;
        // eslint-disable-next-line no-console
        console.log(`\n  ${sig} — graceful shutdown…`);
        await admin.stop();
        console.log('  ✓ stopped cleanly.');
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch(e => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
