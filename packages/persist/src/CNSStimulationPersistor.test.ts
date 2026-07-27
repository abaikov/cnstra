import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import { CNSProgressSerializer } from './CNSProgressSerializer';
import { CNSStimulationPersistor } from './CNSStimulationPersistor';
import { CNSInMemoryStimulationRepository } from './CNSInMemoryStimulationRepository';

const ENTRY_ = [{ collateralName: 'input', payload: { id: 1 } }];

// n1 → n2; n2 fails on the first pass. Same shape as the serializer test, but here
// we drive it through the persistor + stimulation repository (run/attempt model).
function buildFlow() {
    const input = collateral<{ id: number }>();
    const step1Out = collateral<{ id: number }>();
    const output = collateral<{ result: string }>();

    const control = { failStep2: true };

    const n1 = neuron({ step1Out }).dendrite({
        collateral: input,
        response: (p, axon) => axon.step1Out.createSignal({ id: p!.id }),
    });
    const n2 = withCtx<{ attempt: number }>()
        .neuron({ output })
        .dendrite({
            collateral: step1Out,
            response: (p, axon, ctx) => {
                ctx.set({ attempt: (ctx.get()?.attempt ?? 0) + 1 });
                if (control.failStep2) throw new Error('boom');
                return axon.output.createSignal({ result: `ok-${p!.id}` });
            },
        });

    const cns = new CNS([n1, n2]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('n1', n1);
    registry.register('n2', n2);
    registry.registerCollateral('input', input);
    return { cns, registry, input, control };
}

const ENTRY = [{ collateralName: 'input', payload: { id: 1 } }];

test('persistor: records a failed run with a resumable frontier, then a resumed success', async () => {
    const { cns, registry, input, control } = buildFlow();
    const serializer = new CNSProgressSerializer(registry);
    const repository = new CNSInMemoryStimulationRepository();

    // Attempt 1 — fails. Persistor keeps run.progress + the attempt marker.
    const p1 = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: 'run-1',
        stimulationAttemptId: 'run-1#1',
        attemptNumber: 1,
        entry: ENTRY,
    });
    const stim1 = cns.stimulate(input.createSignal({ id: 1 }), {
        onResponse: p1.onResponse,
    });
    await expect(stim1.waitUntilComplete()).rejects.toBeDefined();
    p1.dispose();

    const run = await repository.getStimulation('run-1');
    expect(run?.status).toBe('failed');
    expect(run?.entry).toEqual({ collateralName: 'input', payload: { id: 1 } });
    expect(run?.progress.tasks?.[0]?.neuronName).toBe('n2'); // resumable frontier
    const attempts1 = await repository.getAttempts('run-1');
    expect(attempts1.map(a => a.status)).toEqual(['failed']);

    // Resume — hydrate the persisted frontier and activate as attempt 2.
    control.failStep2 = false;
    const { tasks, ctx } = serializer.hydrate(run!.progress);
    const p2 = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: 'run-1',
        stimulationAttemptId: 'run-1#2',
        attemptNumber: 2,
        entry: ENTRY,
    });
    const stim2 = cns.activate(tasks, { ctx, onResponse: p2.onResponse });
    await stim2.waitUntilComplete();
    p2.dispose();

    const runDone = await repository.getStimulation('run-1');
    expect(runDone?.status).toBe('completed');
    expect(runDone?.progress.tasks).toHaveLength(0); // nothing left to resume
    expect(runDone?.entry).toEqual({
        collateralName: 'input',
        payload: { id: 1 },
    }); // origin preserved across attempts

    const attempts2 = await repository.getAttempts('run-1');
    expect(attempts2.map(a => a.attemptNumber)).toEqual([1, 2]);
    expect(attempts2.map(a => a.status)).toEqual(['failed', 'completed']);
});

test("full volume: records per-task history with names + inputIndex dedup", async () => {
    const { cns, registry, input, control } = buildFlow();
    control.failStep2 = false;
    const repository = new CNSInMemoryStimulationRepository();

    const p = new CNSStimulationPersistor({
        repository,
        registry,
        stimulationId: 'run-f',
        stimulationAttemptId: 'run-f#1',
        attemptNumber: 1,
        entry: ENTRY_,
        volume: 'full',
    });
    const stim = cns.stimulate(input.createSignal({ id: 1 }), {
        onResponse: p.onResponse,
    });
    await stim.waitUntilComplete();
    p.dispose();

    const tasks = await repository.getTasks('run-f#1');
    // neuron always resolved (via response.neuron) — even name-based
    expect(tasks.map(t => t.neuronName)).toEqual(['n1', 'n2']);
    expect(tasks.map(t => t.dendriteCollateralName)).toEqual([
        'input',
        'step1Out',
    ]);
    // input space is [ entry(0), tasks(1..) ]: n1 ← entry slot 0; n2 ← n1's output (slot 1)
    expect(tasks.map(t => t.index)).toEqual([1, 2]);
    expect(tasks.map(t => t.inputIndex)).toEqual([0, 1]);
    expect(tasks.map(t => t.output?.collateralName)).toEqual([
        'step1Out',
        'output',
    ]);
    expect(tasks.every(t => t.status === 'done')).toBe(true);

    const run = await repository.getStimulation('run-f');
    expect(run?.status).toBe('completed');
});
