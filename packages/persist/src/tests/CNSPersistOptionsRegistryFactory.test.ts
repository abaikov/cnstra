import { collateral, neuron } from '@cnstra/core';
import type { TCNSModality } from '@cnstra/types';
import { CNSPersistOptionsRegistryFactory } from '../CNSPersistOptionsRegistryFactory';

const createPaymentsGraph = () => {
    const charge = collateral<{ orderId: string }>();
    const done = collateral<{ orderId: string }>();
    const chargeNeuron = neuron({ done }).dendrite({ collateral: charge, response: () => undefined });
    const web: TCNSModality = { index: 7, afferentPaths: {} };
    return { charge, done, chargeNeuron, web };
};

describe('CNSPersistOptionsRegistryFactory.create', () => {
    it('keeps two neurons with the same axon key apart', () => {
        const userDone = collateral<{ id: string }>();
        const libDone = collateral<{ id: string }>();
        const userNeuron = neuron({ done: userDone });
        const libNeuron = neuron({ done: libDone });

        const registry = CNSPersistOptionsRegistryFactory.create({ userNeuron, libNeuron });

        expect(registry.getCollateral('userNeuron.done')).toBe(userDone);
        expect(registry.getCollateral('libNeuron.done')).toBe(libDone);
    });

    it('names everything inside a namespace after its key, so the same graph fits twice', () => {
        const payments = createPaymentsGraph();
        const refunds = createPaymentsGraph();

        const registry = CNSPersistOptionsRegistryFactory.create({ payments, refunds });

        expect(registry.getNeuron('payments.chargeNeuron')).toBe(payments.chargeNeuron);
        expect(registry.getNeuron('refunds.chargeNeuron')).toBe(refunds.chargeNeuron);
        expect(registry.getCollateralName(payments.done)).toBe('payments.chargeNeuron.done');
        expect(registry.getCollateralName(payments.charge)).toBe('payments.charge');
        expect(registry.getModalityName(refunds.web)).toBe('refunds.web');
        expect([...registry.getNamedNeurons().keys()]).toEqual(['payments.chargeNeuron', 'refunds.chargeNeuron']);
    });

    it('prefixes explicit collateral names with the namespace', () => {
        const created = collateral<{ id: string }>();
        const deckNeuron = neuron({ created });

        const registry = CNSPersistOptionsRegistryFactory.create({
            decks: { deck: { neuron: deckNeuron, collaterals: { created: 'deck-created' } } },
        });

        expect(registry.getNeuronName(deckNeuron as never)).toBe('decks.deck');
        expect(registry.getCollateralName(created)).toBe('decks.deck-created');
    });

    it('checks explicit collateral names against the axon, also inside a namespace', () => {
        const deckNeuron = neuron({ created: collateral<{ id: string }>() });

        expect(() =>
            CNSPersistOptionsRegistryFactory.create({
                // @ts-expect-error
                deck: { neuron: deckNeuron, collaterals: { creatd: 'deck-created' } },
            })
        ).toThrow('its axon has no such key');
        expect(() =>
            CNSPersistOptionsRegistryFactory.create({
                // @ts-expect-error
                decks: { deck: { neuron: deckNeuron, collaterals: { creatd: 'deck-created' } } },
            })
        ).toThrow('its axon has no such key');
    });

    it('throws on one free collateral listed under two names', () => {
        const input = collateral<{ id: string }>();
        expect(() => CNSPersistOptionsRegistryFactory.create({ start: input, kickoff: input })).toThrow(
            'it is already registered as "start"'
        );
    });

    it('names a listed collateral after the neuron that owns it, wherever it is listed', () => {
        const done = collateral<{ id: string }>();
        const registry = CNSPersistOptionsRegistryFactory.create({ done, a: neuron({ done }) });

        expect(registry.getCollateralName(done)).toBe('a.done');
        expect(registry.getCollateral('done')).toBeUndefined();
    });

    it('throws on a value it cannot name, with its path', () => {
        expect(() =>
            CNSPersistOptionsRegistryFactory.create({ payments: { retries: 3 } } as never)
        ).toThrow('"payments.retries" is not a neuron');
    });
});
