import { CNS, collateral, neuron } from '../src/index';

describe('a collateral is owned by one neuron', () => {
    const clicked = collateral<{ title: string }>();
    const started = collateral<{ title: string }>();

    it('rejects two neurons whose axons hold the same collateral when the CNS is constructed', () => {
        const deckAxon = { deckCreated: collateral<{ title: string }>() };
        const deckFromClick = neuron(deckAxon).dendrite({
            collateral: clicked,
            response: (payload, axon) => axon.deckCreated.createSignal(payload),
        });
        const deckFromOnboarding = neuron(deckAxon).dendrite({
            collateral: started,
            response: (payload, axon) => axon.deckCreated.createSignal(payload),
        });
        expect(() => new CNS([deckFromClick, deckFromOnboarding])).toThrow(
            `collateral "deckCreated" #${deckAxon.deckCreated.index} is in the axons of neuron #${deckFromClick.index} (axon: deckCreated) and neuron #${deckFromOnboarding.index} (axon: deckCreated)`
        );
    });

    it('rejects the same neuron listed twice, which would run each of its dendrites twice', () => {
        const deckAxon = { deckCreated: collateral<{ title: string }>() };
        const deck = neuron(deckAxon).dendrite({
            collateral: clicked,
            response: (payload, axon) => axon.deckCreated.createSignal(payload),
        });
        expect(() => new CNS([deck, deck])).toThrow(`neuron #${deck.index} (axon: deckCreated) is listed twice`);
    });

    it('joins two branches through one dendrite per branch on the listener', async () => {
        const fromClick = collateral<{ title: string }>();
        const fromOnboarding = collateral<{ title: string }>();
        const clickBranch = neuron({ fromClick }).dendrite({
            collateral: clicked,
            response: (payload, axon) => axon.fromClick.createSignal(payload),
        });
        const onboardingBranch = neuron({ fromOnboarding }).dendrite({
            collateral: started,
            response: (payload, axon) => axon.fromOnboarding.createSignal(payload),
        });
        const titles: string[] = [];
        const listener = neuron({})
            .dendrite({ collateral: fromClick, response: payload => { titles.push(payload.title); } })
            .dendrite({ collateral: fromOnboarding, response: payload => { titles.push(payload.title); } });
        const cns = new CNS([clickBranch, onboardingBranch, listener]);

        await cns.stimulate(clicked.createSignal({ title: 'a' })).waitUntilComplete();
        await cns.stimulate(started.createSignal({ title: 'b' })).waitUntilComplete();

        expect(titles).toEqual(['a', 'b']);
        expect(cns.network.getParentNeuronByCollateral(fromClick)).toBe(clickBranch);
        expect(cns.network.getParentNeuronByCollateral(fromOnboarding)).toBe(onboardingBranch);
    });
});
