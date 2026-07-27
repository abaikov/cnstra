/**
 * Same durable "import user" flow, but delivered through pg-boss (Postgres) — one
 * job = one run. The neuron fails on the first pass; pg-boss retries the SAME job,
 * and the CNStra worker RESUMES the outstanding frontier from the resume repository
 * instead of re-running from the entry signal.
 *
 *   cd packages/examples
 *   npm run pg:up          # starts Postgres via docker compose
 *   npm run demo:pgboss
 *   npm run pg:down        # tears it down
 *
 * Needs Postgres (DATABASE_URL, default postgres://cnstra:cnstra@localhost:5432/cnstra).
 * The pure-engine version with no infra is durable-inprocess.ts.
 */
import { PgBoss } from 'pg-boss';
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { createCNSWorker, enqueueStimulation, stimulationJob } from '@cnstra/pg-boss';
import { CNSPgBossProgressRepository } from '@cnstra/pg-boss/postgres-progress';

const DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://cnstra:cnstra@localhost:5432/cnstra';

const input = collateral<{ userId: string }>();
const userFetched = collateral<{ id: string }>();
const userSaved = collateral<{ id: string; ok: true }>();

// Fail the first pass; a module-level attempt counter clears the fault on the
// pg-boss retry (same process), so the resumed attempt succeeds.
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
    console.log('  pg-boss started; queue "cns" ready.\n');

    // Durable worker: one job → one stimulation, resuming across the job's retries.
    await createCNSWorker({
        boss: boss as never,
        cns,
        registry,
        queue: 'cns',
        // pg-boss can't hold arbitrary per-hop progress on its job row, so the
        // resume checkpoint lives in its OWN Postgres table (cns_pgboss_progress),
        // shipped in @cnstra/pg-boss/postgres-progress. Swap in any other
        // ICNSProgressRepository (e.g. @cnstra/progress-redis) to store it elsewhere.
        resume: {
            repository: new CNSPgBossProgressRepository({
                connectionString: DATABASE_URL,
            }),
        },
    });

    // Producer: enqueue by (registered) collateral name, with retries enabled so
    // pg-boss auto-retries the failing job and the worker resumes it.
    const job = stimulationJob(registry, input, { userId: '42' });
    await enqueueStimulation(boss as never, 'cns', job, {
        retryLimit: 3,
        retryDelay: 1,
    });
    console.log('  enqueued job: SIG.input { userId: "42" } (retryLimit 3)\n');
    console.log('  watch: attempt #1 throws → pg-boss retries → resume completes it.\n');

    // Let the worker run + pg-boss retry, then exit.
    await new Promise(r => setTimeout(r, 8000));
    await boss.stop();
    console.log(`\n  ✅ Done. Total persistUser invocations: ${attempt} (1 fail + 1 resumed success).`);
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
