/**
 * Constructor matrix: **BullMQ broker × explicit Redis progress store.**
 *
 * By default `@cnstra/bullmq` keeps the checkpoint in the job's OWN native progress
 * (see bull-resumable.ts). Here we SWAP that for an explicit `@cnstra/progress-redis`
 * store (a separate key namespace) — same broker, different progress backend — to show
 * the progress store is a pluggable choice. Same resumable behaviour: fail → retry →
 * resume the frontier loaded from Redis.
 *
 *   npm run redis:up
 *   npm run demo:bull:redis
 */
import { Queue, Worker } from 'bullmq';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { createCNSWorker, enqueueCNSStimulation, cnsStimulationJob } from '@cnstra/bullmq';
import { CNSRedisProgressRepository } from '@cnstra/progress-redis';

const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
};
const QUEUE = 'cns';

const input = cnsCollateral<{ userId: string }>();
const userFetched = cnsCollateral<{ id: string }>();
const userSaved = cnsCollateral<{ id: string; ok: true }>();

let attempt = 0;

const importUser = cnsNeuron({ userFetched }).dendrite({
    collateral: input,
    response: (p, axon) => {
        console.log(`    ▸ importUser(${p!.userId})`);
        return axon.userFetched.createSignal({ id: p!.userId });
    },
});
const persistUser = cnsNeuron({ userSaved }).dendrite({
        collateral: userFetched,
        response: (p, axon) => {
            attempt++;
            console.log(`    ▸ persistUser(${p!.id}) — global attempt #`);
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

    const { worker, shutdown } = createCNSWorker({
        Worker,
        workerOptions: { connection },
        cns,
        registry,
        queue: QUEUE,
        resume: { repository: progress }, // ← explicit Redis store, not the native job progress
    });
    worker.on('failed', (_job, err) => console.log(`    · job failed (BullMQ will retry): ${err.message}`)
    );

    const job = cnsStimulationJob(registry, input, { userId: '42' });
    await enqueueCNSStimulation(queue, job, { attempts: 3, backoff: { type: 'fixed', delay: 500 } });
    console.log('  enqueued; attempt #1 throws → BullMQ retries → resume from Redis repo completes it.\n');

    await new Promise(r => setTimeout(r, 8000));
    await shutdown();
    await queue.close();
    await progress.close();
    console.log(`\n  ✅ Done. persistUser invocations: ${attempt} (1 fail + 1 resumed).`);
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
