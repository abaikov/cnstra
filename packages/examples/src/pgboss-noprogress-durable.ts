/**
 * Constructor matrix: **pg-boss broker × NO progress store (thin mode).**
 *
 * Omit `resume` entirely and there is no CNStra checkpoint at all — you get pg-boss's
 * plain job retry: a retried job re-runs the WHOLE flow from the entry signal (no
 * frontier resume, no context carried). This is the "just an admin over pg-boss jobs,
 * nothing fancy" mode. Contrast with pgboss-durable.ts (Postgres checkpoint) where the
 * retry resumes ONLY the failed neuron.
 *
 *   npm run pg:up
 *   npm run demo:pgboss:noprogress
 *
 * Expect: importUser runs TWICE (re-run from entry), ctx.tries resets to 1 each attempt.
 */
import { PgBoss } from 'pg-boss';
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { createCNSWorker, enqueueStimulation, stimulationJob } from '@cnstra/pg-boss';

const DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://cnstra:cnstra@localhost:5432/cnstra';

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
    console.log('  pg-boss queue "cns" ready; NO checkpoint store (thin mode).\n');

    // NO `resume` → plain pg-boss retry, re-run from entry.
    await createCNSWorker({ boss: boss as never, cns, registry, queue: 'cns' });

    const job = stimulationJob(registry, input, { userId: '42' });
    await enqueueStimulation(boss as never, 'cns', job, { retryLimit: 3, retryDelay: 1 });
    console.log('  enqueued; attempt #1 throws → pg-boss retries the WHOLE flow from entry.\n');

    await new Promise(r => setTimeout(r, 8000));
    await boss.stop();
    console.log(`\n  ✅ Done. persistUser invocations: ${attempt}. importUser re-ran from entry (no resume).`);
    process.exit(0);
}

void main().catch(e => {
    console.error(e);
    process.exit(1);
});
