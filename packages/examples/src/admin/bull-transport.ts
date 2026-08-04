/**
 * Route the admin's commands through a REAL BullMQ (Redis) queue.
 *
 * `launch` / `clone` / `retry` enqueue a command job; an in-process worker pulls
 * it and runs it against the same StimulationRunManager (which keeps the rich
 * run/attempt/task store the UI renders). This is the CNStra admin operating a
 * real broker — instead of Bull's own dashboard.
 *
 * bullmq is imported lazily so the default in-process admin needs no Redis.
 */
import type { StimulationRunManager, TStimulationCommand } from './stimulation-manager';

export async function attachBullTransport(
    manager: StimulationRunManager
): Promise<{ close: () => Promise<void> }> {
    const { Queue, Worker } = await import('bullmq');
    const connection = {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
    };
    const QUEUE = 'cns-admin';

    const queue = new Queue(QUEUE, { connection });
    const worker = new Worker(
        QUEUE,
        async job => {
            await manager.handle(job.data as TStimulationCommand);
        },
        { connection, concurrency: 1 }
    );

    // Every admin action becomes a durable job on Redis.
    manager.setDispatch(async (cmd: TStimulationCommand) => {
        await queue.add('cmd', cmd as unknown as object, {
            removeOnComplete: true,
            removeOnFail: true,
        });
    });

    return {
        close: async () => {
            await worker.close();
            await queue.close();
        },
    };
}
