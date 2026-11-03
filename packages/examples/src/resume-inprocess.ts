/**
 * Runnable, zero-infra demo of CNStra resumable execution: a run fails partway,
 * then RESUMES from the exact frontier (not from scratch) on a second attempt —
 * and the whole run/attempt/task history is stored in a repository, which is
 * exactly the data the DevTools "resumable runs" admin renders.
 *
 *   npm run demo:resumable   (from packages/examples)
 *
 * No Postgres/Redis needed — this is the resumable-execution ENGINE in-process. The
 * pg-boss variant (queue + Postgres) is in pgboss-resumable.ts.
 */
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSProgressSerializer,
    CNSInMemoryStimulationRepository,
    CNSStimulationPersistor,
} from '@cnstra/persist';

// ── a small "import user" flow: importUser → enrichUser → persistUser ──
const input = cnsCollateral<{ userId: string }>();
const userFetched = cnsCollateral<{ id: string; name: string }>();
const userEnriched = cnsCollateral<{ id: string; name: string; plan: string }>();
const userSaved = cnsCollateral<{ id: string; ok: true }>();

// A fault we can toggle: persistUser throws on the first attempt.
const control = { failPersist: true };

const importUser = cnsNeuron({ userFetched }).dendrite({
    collateral: input,
    response: (p, axon) => {
        console.log(`    ▸ importUser(${p!.userId})`);
        return axon.userFetched.createSignal({ id: p!.userId, name: 'Neo Anderson' });
    },
});
const enrichUser = cnsNeuron({ userEnriched }).dendrite({
    collateral: userFetched,
    response: (p, axon) => {
        console.log(`    ▸ enrichUser(${p!.id})`);
        return axon.userEnriched.createSignal({ ...p!, plan: 'pro' });
    },
});
const persistUser = cnsNeuron({ userSaved }).dendrite({
    collateral: userEnriched,
    response: (p, axon) => {
        console.log(`    ▸ persistUser(${p!.id})`);
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

const STIM_ID = 'stim:import-user:42';
const ENTRY = [{ collateralName: 'input', payload: { userId: '42' } }];

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(64));

async function printAdminView(label: string): Promise<void> {
    rule();
    line(`  🖥️  DEVTOOLS ADMIN VIEW — ${label}`);
    rule();
    const stimulation = await repository.getStimulation(STIM_ID);
    if (!stimulation) return line('  (no stimulation)');
    line(`  STIM  ${stimulation.stimulationId}   [${stimulation.status.toUpperCase()}]`);
    line(`  entry: ${stimulation.entry.collateralName} ← ${JSON.stringify(stimulation.entry.payload)}`);
    const frontier = stimulation.progress.tasks.map(t => t.neuronName).join(', ') || '—';
    line(`  frontier (resumable): ${frontier}`);
    line('');
    const attempts = await repository.getAttempts(STIM_ID);
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
    line('  CNStra resumable execution — fail, then RESUME (not restart)');
    line('');

    // ── Attempt 1: runs importUser → enrichUser, then persistUser THROWS ──
    line('  ● Attempt #1 (persistUser will fail):');
    const p1 = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: STIM_ID,
        stimulationAttemptId: `${STIM_ID}#1`,
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
    const stimulation = await repository.getStimulation(STIM_ID);
    const { tasks } = serializer.hydrate(stimulation!.progress);
    const p2 = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: STIM_ID,
        stimulationAttemptId: `${STIM_ID}#2`,
        attemptNumber: 2,
        entry: ENTRY,
        volume: 'full',
    });
    const stim2 = cns.activate(tasks, { onResponse: p2.onResponse });
    await stim2.waitUntilComplete();
    p2.dispose();
    line('');
    await printAdminView('after retry (attempt #2)');

    line('  ✅ Done. importUser/enrichUser did NOT re-run — only the failed');
    line('     frontier (persistUser) was resumed from its input signal.');
    line('');
}

void main();
