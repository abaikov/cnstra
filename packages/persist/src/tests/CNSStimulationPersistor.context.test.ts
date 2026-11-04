import { CNS, collateral, neuron } from '@cnstra/core';
import type { TCNSStimulationResponse } from '@cnstra/types';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSStimulationPersistor } from '.././CNSStimulationPersistor';
import { CNSInMemoryStimulationRepository } from '.././CNSInMemoryStimulationRepository';

/**
 * An activation's context store belongs to the activation, whichever moment you
 * look at it in: the frontier row of one still to run, and the history row of one
 * that ran. This covers the second — what the panel's waterfall reads.
 */

const buildFlow = () => {
    const input = collateral<{ id: number }>();
    const out = collateral<{ ok: boolean }>();

    const worker = neuron({ out }).dendrite({
        collateral: input,
        response: (_p, axon) => axon.out.createSignal({ ok: true }),
    });
    const sink = neuron({}).dendrite({
        collateral: out,
        response: () => undefined,
    });

    const registry = new CNSPersistOptionsRegistry();
    registry.register('worker', worker);
    registry.register('sink', sink);
    registry.registerCollateral('input', input);

    return { cns: new CNS([worker, sink]), input, registry };
};

const run = async (stamp?: (response: TCNSStimulationResponse) => void) => {
    const flow = buildFlow();
    const repository = new CNSInMemoryStimulationRepository();
    const persistor = new CNSStimulationPersistor({
        repository,
        registry: flow.registry,
        stimulationId: 'run-1',
        stimulationAttemptId: 'run-1#1',
        attemptNumber: 1,
        entry: [{ collateralName: 'input', payload: { id: 1 } }],
        volume: 'full',
    });

    await flow.cns
        .stimulate(flow.input.createSignal({ id: 1 }), {
            onResponse: response => {
                stamp?.(response);
                return persistor.onResponse(response);
            },
        })
        .waitUntilComplete();
    await persistor.dispose();

    return repository.getTasks('run-1#1');
};

describe('the history row carries the activation context', () => {
    it('records what was attached to that activation', async () => {
        const tasks = await run(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['my-app'] = { requestId: 'r-9' };
        });

        expect(tasks).not.toHaveLength(0);
        for (const task of tasks)
            expect(task.activationContext).toEqual({
                'my-app': { requestId: 'r-9' },
            });
    });

    it('keeps each activation to its own', async () => {
        let n = 0;
        const tasks = await run(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['seq'] = n++;
        });

        const seen = tasks.map(t => t.activationContext?.['seq']);
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('leaves the field off when nothing was attached', async () => {
        const tasks = await run();

        for (const task of tasks)
            expect(task.activationContext).toBeUndefined();
    });

    it('records only the portable part', async () => {
        // A live handle means nothing to whoever reads the history later.
        const tasks = await run(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['tracer'] = {
                    live: () => 'span',
                    traceparent: '00-abc-def-01',
                };
        });

        for (const task of tasks)
            expect(task.activationContext).toEqual({
                tracer: { traceparent: '00-abc-def-01' },
            });
    });
});
