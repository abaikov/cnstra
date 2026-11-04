import { CNS, collateral, neuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSStimulationPersistor } from '.././CNSStimulationPersistor';
import type { ICNSStimulationWriter } from '.././interfaces/ICNSStimulationRepository';
import type { TCNSStimulationState } from '@cnstra/persist-dto';

/**
 * Every checkpoint used to re-read the stimulation record to recover two values
 * that cannot change while the run is alive: the original entry signal (a
 * Clone's origin, not this attempt's) and the scope. Checkpoints are serialised,
 * so the answer after the first one is always the one we ourselves wrote.
 */

const ENTRY = [{ collateralName: 'input', payload: { id: 1 } }];

/** input → a → b → c → d: four hops, so the barrier checkpoints four times. */
const buildFlow = () => {
    const input = collateral<{ n: number }>();
    const a = collateral<{ n: number }>();
    const b = collateral<{ n: number }>();
    const c = collateral<{ n: number }>();

    const first = neuron({ a }).dendrite({
        collateral: input,
        response: (p, axon) => axon.a.createSignal({ n: p!.n + 1 }),
    });
    const second = neuron({ b }).dendrite({
        collateral: a,
        response: (p, axon) => axon.b.createSignal({ n: p!.n + 1 }),
    });
    const third = neuron({ c }).dendrite({
        collateral: b,
        response: (p, axon) => axon.c.createSignal({ n: p!.n + 1 }),
    });
    const fourth = neuron({}).dendrite({
        collateral: c,
        response: () => undefined,
    });

    const cns = new CNS([first, second, third, fourth]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('first', first);
    registry.register('second', second);
    registry.register('third', third);
    registry.register('fourth', fourth);
    registry.registerCollateral('input', input);
    return { cns, registry, input };
};

const countingWriter = () => {
    let reads = 0;
    const saved: TCNSStimulationState[] = [];
    const writer: ICNSStimulationWriter = {
        async saveStimulation(stimulation) {
            saved.push(stimulation as TCNSStimulationState);
        },
        async saveAttempt() {},
        async appendTask() {},
        async getStimulation() {
            reads++;
            // What a resumed run finds: the Clone origin, not this attempt's entry.
            return {
                stimulationId: 'stim:1',
                entry: { collateralName: 'origin', payload: { id: 0 } },
                status: 'running',
                scopeName: 'stored-scope',
                progress: { tasks: [] },
            } as TCNSStimulationState;
        },
    };
    return { writer, saved, reads: () => reads };
};

describe('the run identity a checkpoint writes', () => {
    it('is read from the store once, not once per checkpoint', async () => {
        const flow = buildFlow();
        const store = countingWriter();
        const persistor = new CNSStimulationPersistor({
            repository: store.writer,
            registry: flow.registry,
            stimulationId: 'stim:1',
            stimulationAttemptId: 'stim:1#1',
            attemptNumber: 1,
            entry: ENTRY,
            // A barrier flushes on EVERY response, so the checkpoint count is the
            // hop count — no cadence to hide behind.
            barrier: true,
        });

        await flow.cns
            .stimulate(flow.input.createSignal({ n: 0 }), {
                onResponse: persistor.onResponse,
            })
            .waitUntilComplete();
        await persistor.dispose();

        expect(store.saved.length).toBeGreaterThan(1);
        expect(store.reads()).toBe(1);
    });

    it('still carries the stored entry and scope on every checkpoint', async () => {
        const flow = buildFlow();
        const store = countingWriter();
        const persistor = new CNSStimulationPersistor({
            repository: store.writer,
            registry: flow.registry,
            stimulationId: 'stim:1',
            stimulationAttemptId: 'stim:1#2',
            attemptNumber: 2,
            entry: ENTRY,
            barrier: true,
        });

        await flow.cns
            .stimulate(flow.input.createSignal({ n: 0 }), {
                onResponse: persistor.onResponse,
            })
            .waitUntilComplete();
        await persistor.dispose();

        for (const record of store.saved) {
            expect(record.entry).toEqual({
                collateralName: 'origin',
                payload: { id: 0 },
            });
            expect(record.scopeName).toBe('stored-scope');
        }
        // And the last one is still the terminal record.
        expect(store.saved[store.saved.length - 1].status).toBe('completed');
    });
});
