/**
 * Same durable "import user" flow, delivered through BullMQ (Redis) — one job =
 * one run. The neuron fails on the first pass; BullMQ retries the SAME job id,
 * and the CNStra worker RESUMES the outstanding frontier from the resume
 * repository instead of re-running from the entry signal.
 *
 *   cd packages/examples
 *   npm run redis:up          # starts Redis via docker compose
 *   npm run demo:bull
 *   npm run redis:down        # tears it down
 *
 * Needs Redis (REDIS_HOST/REDIS_PORT, default 127.0.0.1:6379).
 * The pure-engine version with no infra is durable-inprocess.ts; the retry admin
 * over a browser is `npm run demo:admin`.
 */
import { Queue, Worker } from 'bullmq';
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import {
    createCNSWorker,
    enqueueStimulation,
    stimulationJob,
} from '@cnstra/bullmq';

const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
};
const QUEUE = 'cns';

const input = collateral<{ userId: string }>();
const userFetched = collateral<{ id: string }>();
const userSaved = collateral<{ id: string; ok: true }>();

// Fail the first pass; a module-level attempt counter clears the fault on the
// BullMQ retry (same process), so the resumed attempt succeeds.
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
            console.log(
                `    ▸ persistUser(${p!.id}) — global attempt #${attempt}, ctx.tries=${tries}`
            );
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
    console.log('  BullMQ queue "cns" ready.\n');

    // Durable worker: one job → one stimulation, resuming across the job's retries.
    const worker = createCNSWorker({
        // BullMQ's Worker class is structurally wider than the package's minimal
        // ctor type; pass it through (same as the pg-boss demo's `boss as never`).
        Worker: Worker as never,
        cns,
        registry,
        queue: QUEUE,
        connection,
        // No repository → the resume checkpoint lives in BullMQ's OWN per-job
        // progress (job.updateProgress / job.progress, in Redis). No side store.
        resume: {},
    });
    worker.on('failed', (job: unknown, err: unknown) =>
        console.log(
            `    · job failed (BullMQ will retry): ${
                err instanceof Error ? err.message : String(err)
            }`
        )
    );

    // Producer: enqueue by (registered) collateral name, with retries enabled so
    // BullMQ auto-retries the failing job and the worker resumes it.
    const job = stimulationJob(registry, input, { userId: '42' });
    await enqueueStimulation(queue, job, {
        attempts: 3,
        backoff: { type: 'fixed', delay: 500 },
    });
    console.log('  enqueued job: SIG.input { userId: "42" } (attempts 3)\n');
    console.log('  watch: attempt #1 throws → BullMQ retries → resume completes it.\n');

    // Let the worker run + BullMQ retry, then exit.
    await new Promise(r => setTimeout(r, 8000));
    await worker.close();
    await queue.close();
    console.log(
        `\n  ✅ Done. Total persistUser invocations: ${attempt} (1 fail + 1 resumed success).`
    );
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
