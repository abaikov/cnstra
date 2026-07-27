/**
 * Constructor matrix: **pg-boss broker × Redis progress store.**
 *
 * The progress store is independent of the broker — here the pg-boss worker keeps its
 * resume checkpoint in Redis (via @cnstra/progress-redis) instead of a Postgres table.
 * Same durable behaviour: attempt #1 fails → pg-boss retries the same job → the worker
 * resumes the outstanding frontier loaded from Redis.
 *
 *   npm run redis:up
 *   npm run demo:pgboss:redis
 *
 * Needs BOTH Postgres (for the pg-boss queue) and Redis (for the checkpoint).
 */
import { PgBoss } from 'pg-boss';
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { createCNSWorker, enqueueStimulation, stimulationJob } from '@cnstra/pg-boss';
import { CNSRedisProgressRepository } from '@cnstra/progress-redis';

const DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://cnstra:cnstra@localhost:5432/cnstra';
const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
};

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
    const boss = new PgBoss(DATABASE_URL);
    boss.on('error', e => console.error('[pg-boss]', e.message));
    await boss.start();
    await boss.createQueue('cns');
    const progress = new CNSRedisProgressRepository({ connection });
    console.log('  pg-boss queue "cns" ready; checkpoint store = Redis.\n');

    await createCNSWorker({
        boss: boss as never,
        cns,
        registry,
        queue: 'cns',
        resume: { repository: progress }, // ← Redis, not the pg-boss Postgres table
    });

    const job = stimulationJob(registry, input, { userId: '42' });
    await enqueueStimulation(boss as never, 'cns', job, { retryLimit: 3, retryDelay: 1 });
    console.log('  enqueued; attempt #1 throws → pg-boss retries → resume from Redis completes it.\n');

    await new Promise(r => setTimeout(r, 8000));
    await boss.stop();
    await progress.close();
    console.log(`\n  ✅ Done. persistUser invocations: ${attempt} (1 fail + 1 resumed).`);
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
