/**
 * Route the admin's commands through a REAL pg-boss (Postgres) queue.
 *
 * Mirror of bull-transport.ts: `launch` / `clone` / `retry` enqueue a command
 * job on a pg-boss queue; an in-process worker pulls it and runs it against the
 * same DurableRunManager (which keeps the rich run/attempt/task store the UI
 * renders). The CNStra admin operating a real broker — instead of pg-boss's own
 * (nonexistent) UI.
 *
 * pg-boss is imported lazily so the default in-process admin needs no Postgres.
 */
import type { DurableRunManager, TRunCommand } from './run-manager';

export async function attachPgBossTransport(
    manager: DurableRunManager
): Promise<{ close: () => Promise<void> }> {
    const { PgBoss } = await import('pg-boss');
    const url =
        process.env.DATABASE_URL ??
        'postgres://cnstra:cnstra@localhost:5432/cnstra';
    const QUEUE = 'cns-admin';

    const boss = new PgBoss(url);
    boss.on('error', e => console.error('[pg-boss]', (e as Error).message));
    await boss.start();
    await boss.createQueue(QUEUE);

    // Worker: each command job runs against the shared manager (rich store).
    await boss.work(QUEUE, async (jobs: unknown) => {
        const arr = Array.isArray(jobs) ? jobs : [jobs];
        for (const job of arr)
            await manager.handle((job as { data: TRunCommand }).data);
    });

    // Every admin action becomes a durable job on Postgres.
    manager.setDispatch(async (cmd: TRunCommand) => {
        await boss.send(QUEUE, cmd as unknown as object);
    });

    return {
        close: async () => {
            await boss.stop();
        },
    };
}
