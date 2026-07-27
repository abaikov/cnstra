/**
 * Runnable, zero-infra demo of CNStra durable execution: a run fails partway,
 * then RESUMES from the exact frontier (not from scratch) on a second attempt —
 * and the whole run/attempt/task history is stored in a repository, which is
 * exactly the data the DevTools "durable runs" admin renders.
 *
 *   npm run demo:durable   (from packages/examples)
 *
 * No Postgres/Redis needed — this is the durable-execution ENGINE in-process. The
 * pg-boss variant (queue + Postgres) is in pgboss-durable.ts.
 */
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSProgressSerializer,
    CNSInMemoryStimulationRepository,
    CNSStimulationPersistor,
} from '@cnstra/persist';

// ── a small "import user" flow: importUser → enrichUser → persistUser ──
const input = collateral<{ userId: string }>();
const userFetched = collateral<{ id: string; name: string }>();
const userEnriched = collateral<{ id: string; name: string; plan: string }>();
const userSaved = collateral<{ id: string; ok: true }>();

// A fault we can toggle: persistUser throws on the first attempt.
const control = { failPersist: true };

const importUser = neuron({ userFetched }).dendrite({
    collateral: input,
    response: (p, axon) => {
        console.log(`    ▸ importUser(${p!.userId})`);
        return axon.userFetched.createSignal({ id: p!.userId, name: 'Neo Anderson' });
    },
});
const enrichUser = neuron({ userEnriched }).dendrite({
    collateral: userFetched,
    response: (p, axon) => {
        console.log(`    ▸ enrichUser(${p!.id})`);
        return axon.userEnriched.createSignal({ ...p!, plan: 'pro' });
    },
});
const persistUser = withCtx<{ attempt: number }>()
    .neuron({ userSaved })
    .dendrite({
        collateral: userEnriched,
        response: (p, axon, ctx) => {
            const attempt = (ctx.get()?.attempt ?? 0) + 1;
            ctx.set({ attempt });
            console.log(`    ▸ persistUser(${p!.id}) — attempt #${attempt}`);
            if (control.failPersist) throw new Error('boom: db connection timeout');
            return axon.userSaved.createSignal({ id: p!.id, ok: true });
        },
    });

const cns = new CNS([importUser, enrichUser, persistUser]);

// Registry maps neurons/collaterals ↔ stable names (the only thing portable
// across a process boundary; the resume serializer keys everything by name).
const registry = new CNSPersistOptionsRegistry();
registry.register('importUser', importUser);
registry.register('enrichUser', enrichUser);
registry.register('persistUser', persistUser);
registry.registerCollateral('input', input);

const repository = new CNSInMemoryStimulationRepository();
const serializer = new CNSProgressSerializer(registry);

const RUN_ID = 'run:import-user:42';
const ENTRY = [{ collateralName: 'input', payload: { userId: '42' } }];

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(64));

async function printAdminView(label: string): Promise<void> {
    rule();
    line(`  🖥️  DEVTOOLS ADMIN VIEW — ${label}`);
    rule();
    const run = await repository.getStimulation(RUN_ID);
    if (!run) return line('  (no run)');
    line(`  RUN  ${run.stimulationId}   [${run.status.toUpperCase()}]`);
    line(`  entry: ${run.entry.collateralName} ← ${JSON.stringify(run.entry.payload)}`);
    const frontier = run.progress.tasks.map(t => t.neuronName).join(', ') || '—';
    line(`  frontier (resumable): ${frontier}`);
    line('');
    const attempts = await repository.getAttempts(RUN_ID);
    for (const a of attempts) {
        line(`  ┌ ATTEMPT #${a.attemptNumber}   [${a.status.toUpperCase()}]   ${a.hopCount} hops`);
        const tasks = await repository.getTasks(a.stimulationAttemptId);
        for (const t of tasks) {
            const out = t.output ? `→ ${t.output.collateralName}` : '→ ✗ (threw)';
            const err = t.error ? `   ⚠️  ${t.error}` : '';
            const mark = t.status === 'failed' ? '✗' : '✓';
            line(`  │  ${mark} [${t.index}] ${t.neuronName.padEnd(12)} ${out}${err}`);
        }
        line('  └');
    }
    rule();
    line('');
}

async function main(): Promise<void> {
    line('');
    line('  CNStra durable execution — fail, then RESUME (not restart)');
    line('');

    // ── Attempt 1: runs importUser → enrichUser, then persistUser THROWS ──
    line('  ● Attempt #1 (persistUser will fail):');
    const p1 = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: RUN_ID,
        stimulationAttemptId: `${RUN_ID}#1`,
        attemptNumber: 1,
        entry: ENTRY,
        volume: 'full',
    });
    const stim1 = cns.stimulate(input.createSignal({ userId: '42' }), {
        onResponse: p1.onResponse,
    });
    await stim1.waitUntilComplete().catch(() => {});
    p1.dispose();
    line('');
    await printAdminView('after attempt #1');

    // ── Retry from the panel: fix the fault, RESUME the frontier ──
    line('  🔧 fault fixed — clicking "Retry" resumes the frontier (persistUser only):');
    control.failPersist = false;
    const run = await repository.getStimulation(RUN_ID);
    const { tasks, ctx } = serializer.hydrate(run!.progress);
    const p2 = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: RUN_ID,
        stimulationAttemptId: `${RUN_ID}#2`,
        attemptNumber: 2,
        entry: ENTRY,
        volume: 'full',
    });
    const stim2 = cns.activate(tasks, { ctx, onResponse: p2.onResponse });
    await stim2.waitUntilComplete();
    p2.dispose();
    line('');
    await printAdminView('after retry (attempt #2)');

    line('  ✅ Done. importUser/enrichUser did NOT re-run — only the failed');
    line('     frontier (persistUser) was resumed, with its context intact.');
    line('');
}

void main();
