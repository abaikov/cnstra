import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import { CNSProgressSerializer } from './CNSProgressSerializer';
import { CNSInMemoryProgressRepository } from './CNSInMemoryProgressRepository';
import { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';

// A tiny two-step flow: n1 → n2. n2 fails on the first pass. We snapshot the
// outstanding frontier, JSON round-trip it (as a real durable store would), then
// resume via cns.activate(). Proof points:
//   - n1 does NOT re-run on resume (only the failed frontier is re-activated)
//   - n2's context (attempt counter) is restored across the JSON boundary
function buildFlow() {
    const input = collateral<{ id: number }>();
    const step1Out = collateral<{ id: number }>();
    const output = collateral<{ result: string }>();

    const ran: string[] = [];
    const control = { failStep2: true };

    const n1 = neuron({ step1Out }).dendrite({
        collateral: input,
        response: (p, axon) => {
            ran.push('n1');
            return axon.step1Out.createSignal({ id: p!.id });
        },
    });

    const n2 = withCtx<{ attempt: number }>()
        .neuron({ output })
        .dendrite({
            collateral: step1Out,
            response: (p, axon, ctx) => {
                const attempt = (ctx.get()?.attempt ?? 0) + 1;
                ctx.set({ attempt });
                ran.push(`n2#${attempt}`);
                if (control.failStep2) throw new Error('boom');
                return axon.output.createSignal({
                    result: `ok-${p!.id}-a${attempt}`,
                });
            },
        });

    const cns = new CNS([n1, n2]);

    const registry = new CNSPersistOptionsRegistry();
    registry.register('n1', n1);
    registry.register('n2', n2);
    registry.registerCollateral('input', input);

    return { cns, registry, input, output, ran, control };
}

test('resume: serialize outstanding frontier + context by name, hydrate, activate re-runs only the failed branch', async () => {
    const { cns, registry, input, output, ran, control } = buildFlow();
    const serializer = new CNSProgressSerializer(registry);

    const stim1 = cns.stimulate(input.createSignal({ id: 1 }));
    await expect(stim1.waitUntilComplete()).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2#1']);

    const progress = serializer.serialize(stim1);
    expect(progress.tasks).toHaveLength(1);
    expect(progress.tasks[0].neuronName).toBe('n2');
    expect(progress.context).toEqual({ n2: { attempt: 1 } });
    const roundTripped = JSON.parse(JSON.stringify(progress));

    control.failStep2 = false;
    const { tasks, ctx } = serializer.hydrate(roundTripped);

    const outputs: string[] = [];
    const stim2 = cns.activate(tasks, {
        ctx,
        onResponse: r => {
            if (r.outputSignal?.collateral === output) {
                outputs.push(
                    (r.outputSignal.payload as { result: string }).result
                );
            }
        },
    });
    await stim2.waitUntilComplete();

    expect(ran).toEqual(['n1', 'n2#1', 'n2#2']);
    expect(outputs).toEqual(['ok-1-a2']);
});

test('serialize throws a clear error when a frontier neuron is unregistered', async () => {
    const input = collateral<{ id: number }>();
    const out = collateral<{ ok: boolean }>();
    const failing = neuron({ out }).dendrite({
        collateral: input,
        response: () => {
            throw new Error('boom');
        },
    });
    const cns = new CNS([failing]);
    const registry = new CNSPersistOptionsRegistry();
    registry.registerCollateral('input', input);
    const serializer = new CNSProgressSerializer(registry);

    const stim = cns.stimulate(input.createSignal({ id: 1 }));
    await expect(stim.waitUntilComplete()).rejects.toBeDefined();

    expect(() => serializer.serialize(stim)).toThrow(
        /not.*registered in the CNSPersistOptionsRegistry/
    );
});

test('CNSInMemoryProgressRepository save/load/delete round-trips', async () => {
    const repo = new CNSInMemoryProgressRepository();
    const p = { tasks: [], context: {} };

    expect(await repo.load('job-1')).toBeUndefined();
    await repo.save('job-1', p);
    expect(await repo.load('job-1')).toEqual(p);
    expect(repo.size()).toBe(1);
    await repo.delete('job-1');
    expect(await repo.load('job-1')).toBeUndefined();
});

test('debounced strategy flushes immediately on an error response', () => {
    const strategy = new CNSDebouncedProgressRecordingStrategy();
    let flushed = 0;
    strategy.onResponse({ error: new Error('x') } as never, () => flushed++);
    expect(flushed).toBe(1);
    strategy.dispose();
});

test('debounced strategy coalesces responses then flushes after the debounce', () => {
    jest.useFakeTimers();
    const strategy = new CNSDebouncedProgressRecordingStrategy({
        debounceMs: 100,
        maxStalenessMs: 1000,
    });
    let flushed = 0;
    strategy.onResponse({} as never, () => flushed++);
    strategy.onResponse({} as never, () => flushed++);
    expect(flushed).toBe(0);
    jest.advanceTimersByTime(100);
    expect(flushed).toBe(1);
    strategy.dispose();
    jest.useRealTimers();
});
