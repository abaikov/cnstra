import { CNS, collateral, neuron } from '@cnstra/core';
import type { TCNSStimulationResponse } from '@cnstra/types';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSProgressSerializer } from '.././CNSProgressSerializer';

/**
 * Both context stores cross a process boundary with the frontier they belong to:
 * the run's store on the progress record, an activation's store on its frontier
 * task. What is portable travels; a live handle is left behind rather than
 * pretending it was restored.
 *
 * Everything here round-trips through real JSON, because that is what a store
 * actually does to the record.
 */

/** A flow whose second neuron fails, so there is an outstanding frontier to snapshot. */
function buildFlow() {
    const input = collateral<{ id: number }>();
    const step1Out = collateral<{ id: number }>();
    const control = { fail: true };

    const n1 = neuron({ step1Out }).dendrite({
        collateral: input,
        response: (p, axon) => axon.step1Out.createSignal({ id: p!.id }),
    });
    const n2 = neuron({}).dendrite({
        collateral: step1Out,
        response: () => {
            if (control.fail) throw new Error('boom');
        },
    });

    const registry = new CNSPersistOptionsRegistry();
    registry.register('n1', n1);
    registry.register('n2', n2);
    registry.registerCollateral('input', input);

    return { cns: new CNS([n1, n2]), input, registry, control };
}

/** Run until it fails, snapshot the frontier, and put it through JSON. */
const snapshot = async (
    stamp?: (response: TCNSStimulationResponse) => void,
    stimulationContext?: Record<string, unknown>
) => {
    const flow = buildFlow();
    const serializer = new CNSProgressSerializer(flow.registry);

    const stimulation = flow.cns.stimulate(flow.input.createSignal({ id: 1 }), {
        ...(stimulationContext ? { stimulationContext } : {}),
        onResponse: (response: TCNSStimulationResponse) => stamp?.(response),
    });
    await stimulation.waitUntilComplete().catch(() => undefined);

    const progress = serializer.serialize(stimulation);
    return {
        serializer,
        stored: JSON.parse(JSON.stringify(progress)),
        progress,
    };
};

describe('context stores across a process boundary', () => {
    it('carries an activation store on its frontier task', async () => {
        const { serializer, stored } = await snapshot(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['test'] = { traceparent: 'abc' };
        });

        expect(stored.tasks[0].activationContext).toEqual({
            test: { traceparent: 'abc' },
        });

        // …and hands it back on the task the resumed run will drive.
        const { tasks } = serializer.hydrate(stored);
        expect(tasks[0].activationContext).toEqual({
            test: { traceparent: 'abc' },
        });
    });

    it('carries the run store on the progress record', async () => {
        const { serializer, stored } = await snapshot(undefined, {
            requestId: 'req-7',
        });

        expect(stored.stimulationContext).toEqual({ requestId: 'req-7' });
        expect(serializer.hydrate(stored).stimulationContext).toEqual({
            requestId: 'req-7',
        });
    });

    it('leaves a live handle behind and keeps its portable sibling', async () => {
        const { stored } = await snapshot(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['@cnstra/persist-otel'] = {
                    context: { live: () => 'span' },
                    traceparent: '00-abc-def-01',
                };
        });

        expect(stored.tasks[0].activationContext).toEqual({
            '@cnstra/persist-otel': { traceparent: '00-abc-def-01' },
        });
    });

    it('still snapshots the frontier when a store holds something unportable', async () => {
        // The checkpoint is what resume depends on — telemetry someone attached
        // must never be able to lose it.
        const { stored } = await snapshot(response => {
            for (const task of response.scheduledActivationTasks ?? []) {
                const cyclic: Record<string, unknown> = {};
                cyclic.self = cyclic;
                (task.activationContext ??= {})['bad'] = cyclic;
            }
        });

        expect(stored.tasks).toHaveLength(1);
        expect(stored.tasks[0].neuronName).toBe('n2');
    });

    it('writes no field at all when there is nothing to carry', async () => {
        const { stored } = await snapshot();

        expect(stored.stimulationContext).toBeUndefined();
        expect(stored.tasks[0].activationContext).toBeUndefined();
    });

    it('omits a store that had only unportable values', async () => {
        // An empty object would claim something was carried when nothing was.
        const { stored } = await snapshot(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['live'] = () => 'gone';
        });

        expect(stored.tasks[0].activationContext).toBeUndefined();
    });

    it('reads a record written before any of this existed', async () => {
        // Both fields are optional; an older record hydrates unchanged.
        const { serializer, stored } = await snapshot();
        delete stored.stimulationContext;

        const { tasks, stimulationContext } = serializer.hydrate(stored);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].activationContext).toBeUndefined();
        expect(stimulationContext).toBeUndefined();
    });

    it('resumes with the store the previous attempt left', async () => {
        const first = await snapshot(response => {
            for (const task of response.scheduledActivationTasks ?? [])
                (task.activationContext ??= {})['test'] = 'from-attempt-1';
        });

        const flow = buildFlow();
        flow.control.fail = false;
        const serializer = new CNSProgressSerializer(flow.registry);
        const { tasks } = serializer.hydrate(first.stored);

        let seen: unknown;
        const resumed = flow.cns.activate(tasks as never, {
            onResponse: (response: TCNSStimulationResponse) => {
                if (response.neuron) seen = seen ?? 'ran';
            },
        });
        await resumed.waitUntilComplete();

        // The task that resumes carries what was stored against it.
        expect(tasks[0].activationContext).toEqual({ test: 'from-attempt-1' });
        expect(seen).toBe('ran');
    });
});
