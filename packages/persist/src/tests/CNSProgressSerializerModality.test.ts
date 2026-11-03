import { CNS, cnsAfferentPath, cnsCollateral, cnsModality, cnsNeuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '../CNSPersistOptionsRegistry';
import { CNSProgressSerializer } from '../CNSProgressSerializer';

const buildFlow = () => {
    const input = cnsCollateral<{ id: number }>();
    const step1Out = cnsCollateral<{ id: number }>();
    const output = cnsCollateral<{ by: string }>();
    const ui = cnsAfferentPath();
    const onboarding = cnsAfferentPath();
    const flow = cnsModality({ ui, onboarding });
    const ran: string[] = [];
    const control = { failStep2: true };

    const n1 = cnsNeuron({ step1Out }).dendrite({
        collateral: input,
        response: (payload, axon) => axon.step1Out.createSignal({ id: payload!.id }),
    });
    const n2 = cnsNeuron({ output }).modalityDendrite({
        collateral: step1Out,
        modality: flow,
        afferentPaths: new Map([[onboarding, () => {
            ran.push('onboarding');
            if (control.failStep2) throw new Error('boom');
            return 'onboarding';
        }]]),
        default: () => { ran.push('default'); return 'default'; },
        output: (by: string, axon) => axon.output.createSignal({ by }),
    });

    const registry = new CNSPersistOptionsRegistry();
    registry.register('n1', n1);
    registry.register('n2', n2);
    registry.registerCollateral('input', input);
    registry.registerModality('flow', flow);

    return { cns: new CNS([n1, n2]), registry, input, flow, onboarding, ran, control };
};

describe('resuming a run that was started on an afferent path', () => {
    it('stores the modality and the path by name', async () => {
        const world = buildFlow();
        const serializer = new CNSProgressSerializer(world.registry);
        const stimulation = world.cns.stimulate(world.input.createSignal({ id: 1 }), { modality: world.flow, afferentPath: world.onboarding });
        await expect(stimulation.waitUntilComplete()).rejects.toBeDefined();

        const progress = serializer.serialize(stimulation);

        expect(progress).toMatchObject({ modalityName: 'flow', afferentPathName: 'onboarding' });
    });

    it('resumes on the same path, so the path handler runs again and not the default', async () => {
        const world = buildFlow();
        const serializer = new CNSProgressSerializer(world.registry);
        const stimulation = world.cns.stimulate(world.input.createSignal({ id: 1 }), { modality: world.flow, afferentPath: world.onboarding });
        await expect(stimulation.waitUntilComplete()).rejects.toBeDefined();
        const saved = JSON.parse(JSON.stringify(serializer.serialize(stimulation)));

        world.control.failStep2 = false;
        const { tasks, modality, afferentPath } = serializer.hydrate(saved);
        await world.cns.activate(tasks, { modality, afferentPath }).waitUntilComplete();

        expect(world.ran).toEqual(['onboarding', 'onboarding']);
    });

    it('refuses to serialize a run whose modality is not registered', async () => {
        const world = buildFlow();
        const registryWithoutModality = new CNSPersistOptionsRegistry()
            .register('n1', world.registry.getNeuron('n1')!)
            .register('n2', world.registry.getNeuron('n2')!)
            .registerCollateral('input', world.input);
        const serializer = new CNSProgressSerializer(registryWithoutModality);
        const stimulation = world.cns.stimulate(world.input.createSignal({ id: 1 }), { modality: world.flow, afferentPath: world.onboarding });
        await expect(stimulation.waitUntilComplete()).rejects.toBeDefined();

        expect(() => serializer.serialize(stimulation)).toThrow(/modality/);
    });
});
