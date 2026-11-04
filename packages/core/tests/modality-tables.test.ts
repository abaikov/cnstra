import { CNS, afferentPath, collateral, modality, neuron } from '../src/index';

const createWorld = () => {
    const created = collateral<{ title: string }>();
    const saved = collateral<{ by: string }>();
    const ui = afferentPath();
    const onboarding = afferentPath();
    const onboardingTour = afferentPath(onboarding);
    const flow = modality({ ui, onboarding, onboardingTour });
    const calls: string[] = [];
    return { created, saved, ui, onboarding, onboardingTour, flow, calls };
};

describe('which handler a modality dendrite runs, chosen when the network is built', () => {
    it('never runs the body of a neuron that has no handler for the path and no default', async () => {
        const world = createWorld();
        const onboardingOnly = neuron({ saved: world.saved }).modalityDendrite({
            collateral: world.created,
            modality: world.flow,
            afferentPaths: new Map([[world.onboarding, () => { world.calls.push('onboarding'); return 'onboarding'; }]]),
            output: (by: string, axon) => axon.saved.createSignal({ by }),
        });
        const cns = new CNS([onboardingOnly]);

        await cns.stimulate(world.created.createSignal({ title: 'a' })).waitUntilComplete();
        await cns.stimulate(world.created.createSignal({ title: 'b' }), { modality: world.flow, afferentPath: world.ui }).waitUntilComplete();

        expect(world.calls).toEqual([]);
    });

    it('runs the nearest parent path handler for a child path without its own', async () => {
        const world = createWorld();
        const savingNeuron = neuron({ saved: world.saved }).modalityDendrite({
            collateral: world.created,
            modality: world.flow,
            afferentPaths: new Map([[world.onboarding, () => { world.calls.push('onboarding'); return 'onboarding'; }]]),
            default: () => { world.calls.push('default'); return 'default'; },
            output: (by: string, axon) => axon.saved.createSignal({ by }),
        });
        const cns = new CNS([savingNeuron]);

        await cns.stimulate(world.created.createSignal({ title: 'a' }), { modality: world.flow, afferentPath: world.onboardingTour }).waitUntilComplete();

        expect(world.calls).toEqual(['onboarding']);
    });

    it('wakes the default of a neuron on every path and without one', async () => {
        const world = createWorld();
        const savingNeuron = neuron({ saved: world.saved }).modalityDendrite({
            collateral: world.created,
            modality: world.flow,
            afferentPaths: new Map([[world.ui, () => { world.calls.push('ui'); return 'ui'; }]]),
            default: () => { world.calls.push('default'); return 'default'; },
            output: (by: string, axon) => axon.saved.createSignal({ by }),
        });
        const cns = new CNS([savingNeuron]);

        await cns.stimulate(world.created.createSignal({ title: 'a' })).waitUntilComplete();
        await cns.stimulate(world.created.createSignal({ title: 'b' }), { modality: world.flow, afferentPath: world.ui }).waitUntilComplete();
        await cns.stimulate(world.created.createSignal({ title: 'c' }), { modality: world.flow, afferentPath: world.onboarding }).waitUntilComplete();

        expect(world.calls).toEqual(['default', 'ui', 'default']);
    });

    it('lets two neurons listen to one collateral and split the paths between them', async () => {
        const world = createWorld();
        const tourSaved = collateral<{ by: string }>();
        const regular = neuron({ saved: world.saved }).modalityDendrite({
            collateral: world.created,
            modality: world.flow,
            default: () => { world.calls.push('regular'); return 'regular'; },
            output: (by: string, axon) => axon.saved.createSignal({ by }),
        });
        const tour = neuron({ tourSaved }).modalityDendrite({
            collateral: world.created,
            modality: world.flow,
            afferentPaths: new Map([[world.onboardingTour, () => { world.calls.push('tour'); return 'tour'; }]]),
            output: (by: string, axon) => axon.tourSaved.createSignal({ by }),
        });
        const plain = neuron({}).dendrite({
            collateral: world.created,
            response: () => { world.calls.push('plain'); },
        });
        const cns = new CNS([regular, tour, plain]);

        await cns.stimulate(world.created.createSignal({ title: 'a' })).waitUntilComplete();
        await cns.stimulate(world.created.createSignal({ title: 'b' }), { modality: world.flow, afferentPath: world.onboardingTour }).waitUntilComplete();

        expect(world.calls).toEqual(['regular', 'plain', 'regular', 'tour', 'plain']);
    });

    it('completes a fan-out whose signals reach a neuron that is not woken on this path', async () => {
        const world = createWorld();
        const kickoff = collateral<undefined>();
        const fanOut = neuron({ created: world.created }).dendrite({
            collateral: kickoff,
            response: (_payload, axon) => [axon.created.createSignal({ title: 'a' }), axon.created.createSignal({ title: 'b' })],
        });
        const onboardingOnly = neuron({}).modalityDendrite({
            collateral: world.created,
            modality: world.flow,
            afferentPaths: new Map([[world.onboarding, () => { world.calls.push('onboarding'); }]]),
            output: () => undefined,
        });
        const plain = neuron({}).dendrite({
            collateral: world.created,
            response: () => { world.calls.push('plain'); },
        });
        const cns = new CNS([fanOut, onboardingOnly, plain]);

        await cns.stimulate(kickoff.createSignal(), { modality: world.flow, afferentPath: world.ui }).waitUntilComplete();

        expect(world.calls).toEqual(['plain', 'plain']);
    });
});
