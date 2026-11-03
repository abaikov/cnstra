import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSStimulationPersistor } from '.././CNSStimulationPersistor';
import { CNSInMemoryStimulationRepository } from '.././CNSInMemoryStimulationRepository';

/**
 * `inputIndex` is what the waterfall draws its arrows from: it names the slot the
 * task's input came out of. Resolving it by collateral NAME cannot survive one
 * neuron being entered twice and emitting the same collateral twice — the second
 * write wins and both consumers are recorded against the second task.
 *
 * The engine hands the same signal OBJECT to every subscriber of a collateral, so
 * the object answers the question exactly. These pin that, and pin the two cases
 * where only the name is available.
 */

const recorded = async (build: () => {
    cns: CNS<any>;
    fire: (cns: CNS<any>, onResponse: any) => Promise<void>;
    registry: CNSPersistOptionsRegistry;
    entry: { collateralName: string; payload: unknown }[];
}) => {
    const flow = build();
    const repository = new CNSInMemoryStimulationRepository();
    const persistor = new CNSStimulationPersistor({
        repository,
        registry: flow.registry,
        stimulationId: 'run-1',
        stimulationAttemptId: 'run-1#1',
        attemptNumber: 1,
        entry: flow.entry,
        volume: 'full',
    });

    await flow.fire(flow.cns, persistor.onResponse);
    await persistor.dispose();
    return repository.getTasks('run-1#1');
};

describe('inputIndex names the task that actually produced the input', () => {
    it('points a consumer at its own producer when one neuron fires twice', async () => {
        // `spread` emits `item` twice; `handle` runs once per item. Keyed by
        // collateral name, both handlers were recorded against the SECOND emit.
        const start = cnsCollateral<{ id: number }>();
        const item = cnsCollateral<{ n: number }>();

        const spread = cnsNeuron({ item }).dendrite({
            collateral: start,
            response: (_p, axon) => [
                axon.item.createSignal({ n: 1 }),
                axon.item.createSignal({ n: 2 }),
            ],
        });
        const handle = cnsNeuron({}).dendrite({
            collateral: item,
            response: () => undefined,
        });

        const registry = new CNSPersistOptionsRegistry();
        registry.register('spread', spread);
        registry.register('handle', handle);
        registry.registerCollateral('start', start);

        const tasks = await recorded(() => ({
            cns: new CNS([spread, handle]) as never,
            registry,
            entry: [{ collateralName: 'start', payload: { id: 1 } }],
            fire: async (cns, onResponse) => {
                await cns
                    .stimulate(start.createSignal({ id: 1 }), { onResponse })
                    .waitUntilComplete();
            },
        }));

        const spreads = tasks.filter(t => t.neuronName === 'spread');
        const handlers = tasks.filter(t => t.neuronName === 'handle');
        expect(spreads).toHaveLength(2); // one response per emitted signal
        expect(handlers).toHaveLength(2);

        // Each handler points at a DIFFERENT producing task — the one whose
        // signal it actually consumed — not both at the last one.
        const pointed = handlers.map(t => t.inputIndex);
        expect(new Set(pointed).size).toBe(2);
        for (const index of pointed)
            expect(spreads.map(s => s.index)).toContain(index);
    });

    it('still points an entry consumer at its entry slot', async () => {
        // No producing task exists for an entry signal, so the name map answers.
        const start = cnsCollateral<{ id: number }>();
        const worker = cnsNeuron({}).dendrite({
            collateral: start,
            response: () => undefined,
        });

        const registry = new CNSPersistOptionsRegistry();
        registry.register('worker', worker);
        registry.registerCollateral('start', start);

        const tasks = await recorded(() => ({
            cns: new CNS([worker]) as never,
            registry,
            entry: [{ collateralName: 'start', payload: { id: 1 } }],
            fire: async (cns, onResponse) => {
                await cns
                    .stimulate(start.createSignal({ id: 1 }), { onResponse })
                    .waitUntilComplete();
            },
        }));

        expect(tasks).toHaveLength(1);
        expect(tasks[0].inputIndex).toBe(0);
    });

    it('keeps a straight chain pointing back one link at a time', async () => {
        const a = cnsCollateral<{ id: number }>();
        const b = cnsCollateral<{ id: number }>();
        const c = cnsCollateral<{ id: number }>();

        const first = cnsNeuron({ b }).dendrite({
            collateral: a,
            response: (p, axon) => axon.b.createSignal({ id: p!.id }),
        });
        const second = cnsNeuron({ c }).dendrite({
            collateral: b,
            response: (p, axon) => axon.c.createSignal({ id: p!.id }),
        });
        const third = cnsNeuron({}).dendrite({
            collateral: c,
            response: () => undefined,
        });

        const registry = new CNSPersistOptionsRegistry();
        registry.register('first', first);
        registry.register('second', second);
        registry.register('third', third);
        registry.registerCollateral('a', a);

        const tasks = await recorded(() => ({
            cns: new CNS([first, second, third]) as never,
            registry,
            entry: [{ collateralName: 'a', payload: { id: 1 } }],
            fire: async (cns, onResponse) => {
                await cns
                    .stimulate(a.createSignal({ id: 1 }), { onResponse })
                    .waitUntilComplete();
            },
        }));

        const by = (name: string) => tasks.find(t => t.neuronName === name)!;
        expect(by('first').inputIndex).toBe(0); // the entry slot
        expect(by('second').inputIndex).toBe(by('first').index);
        expect(by('third').inputIndex).toBe(by('second').index);
    });
});
