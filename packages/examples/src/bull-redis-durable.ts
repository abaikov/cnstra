/**
 * Constructor matrix: **BullMQ broker × explicit Redis progress store.**
 *
 * By default `@cnstra/bullmq` keeps the checkpoint in the job's OWN native progress
 * (see bull-durable.ts). Here we SWAP that for an explicit `@cnstra/progress-redis`
 * store (a separate key namespace) — same broker, different progress backend — to show
 * the progress store is a pluggable choice. Same durable behaviour: fail → retry →
 * resume the frontier loaded from Redis.
 *
 *   npm run redis:up
 *   npm run demo:bull:redis
 */
import { Queue, Worker } from 'bullmq';
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { createCNSWorker, enqueueStimulation, stimulationJob } from '@cnstra/bullmq';
import { CNSRedisProgressRepository } from '@cnstra/progress-redis';

const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
};
const QUEUE = 'cns';

const input = collateral<{ userId: string }>();
const userFetched = collateral<{ id: string }>();
const userSaved = collateral<{ id: string; ok: true }>();

let attempt = 0;

const importUser = neuron({ userFetched }).dendrite({
    collateral: input,
    response: (p, axon) => {
        console.log(`    ▸ importUser(${p!.userId})`);
        return axon.userFetched.createSignal({ id: p!.userId });
    },
});
const persistUser = withCtx<{ tries: number }>()
    .neuron({ userSaved })
    .dendrite({
        collateral: userFetched,
        response: (p, axon, ctx) => {
            const tries = (ctx.get()?.tries ?? 0) + 1;
            ctx.set({ tries });
            attempt++;
            console.log(`    ▸ persistUser(${p!.id}) — global attempt #${attempt}, ctx.tries=${tries}`);
            if (attempt === 1) throw new Error('boom: db connection timeout');
            return axon.userSaved.createSignal({ id: p!.id, ok: true });
        },
    });

const cns = new CNS([importUser, persistUser]);
const registry = new CNSPersistOptionsRegistry();
registry.register('importUser', importUser);
registry.register('persistUser', persistUser);
registry.registerCollateral('input', input);

async function main(): Promise<void> {
    const queue = new Queue(QUEUE, { connection });
    const progress = new CNSRedisProgressRepository({
        connection,
        prefix: 'cns:progress:bull',
    });
    console.log('  BullMQ queue "cns" ready; checkpoint store = explicit Redis repo.\n');

    const worker = createCNSWorker({
        Worker: Worker as never,
        cns,
        registry,
        queue: QUEUE,
        connection,
        resume: { repository: progress }, // ← explicit Redis store, not the native job progress
    });
    worker.on('failed', (_job: unknown, err: unknown) =>
        console.log(`    · job failed (BullMQ will retry): ${err instanceof Error ? err.message : String(err)}`)
    );

    const job = stimulationJob(registry, input, { userId: '42' });
    await enqueueStimulation(queue, job, { attempts: 3, backoff: { type: 'fixed', delay: 500 } });
    console.log('  enqueued; attempt #1 throws → BullMQ retries → resume from Redis repo completes it.\n');

    await new Promise(r => setTimeout(r, 8000));
    await worker.close();
    await queue.close();
    await progress.close();
    console.log(`\n  ✅ Done. persistUser invocations: ${attempt} (1 fail + 1 resumed).`);
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
