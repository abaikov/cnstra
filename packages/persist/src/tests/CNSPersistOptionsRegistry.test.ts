import { cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';

/**
 * Both name lookups are reverse maps, not scans. `getNeuronName` always was;
 * `getCollateralName` walked every registered collateral, and it is called on
 * three separate per-hop paths — the persistor, the devtools logger, the tracer —
 * plus twice per frontier task in the serializer.
 *
 * Speed is not what these pin. They pin the behaviour the reverse map has to
 * keep: registration and re-registration.
 */

describe('CNSPersistOptionsRegistry name lookup', () => {
    it('answers with the name a collateral was registered under', () => {
        const registry = new CNSPersistOptionsRegistry();
        const order = cnsCollateral<{ id: number }>();

        registry.registerCollateral('order', order);

        expect(registry.getCollateralName(order)).toBe('order');
        expect(registry.getCollateral('order')).toBe(order);
    });

    it('does not answer for a collateral it never saw', () => {
        const registry = new CNSPersistOptionsRegistry();
        const stranger = cnsCollateral<{ id: number }>();

        expect(registry.getCollateralName(stranger)).toBeUndefined();
    });

    it('refuses a name that belongs to another collateral', () => {
        const registry = new CNSPersistOptionsRegistry();
        registry.registerCollateral('order', cnsCollateral<{ id: number }>());

        expect(() => registry.registerCollateral('order', cnsCollateral<{ id: number }>())).toThrow(
            'cannot register a collateral as "order": another collateral has this name'
        );
    });

    it('refuses a second name for one collateral and accepts the same name again', () => {
        const registry = new CNSPersistOptionsRegistry();
        const order = cnsCollateral<{ id: number }>();
        registry.registerCollateral('order', order);
        registry.registerCollateral('order', order);

        expect(() => registry.registerCollateral('second', order)).toThrow(
            'cannot register a collateral as "second": it is already registered as "order"'
        );
        expect(registry.getCollateralName(order)).toBe('order');
    });

    it('refuses a neuron name and a modality name that are taken', () => {
        const registry = new CNSPersistOptionsRegistry();
        registry.register('worker', cnsNeuron({}));
        registry.registerModality('web', { index: 1, afferentPaths: {} });

        expect(() => registry.register('worker', cnsNeuron({}))).toThrow('another neuron has this name');
        expect(() => registry.registerModality('web', { index: 2, afferentPaths: {} })).toThrow(
            'another modality has this name'
        );
    });

    it('names an axon collateral after its neuron unless a name is given', () => {
        const registry = new CNSPersistOptionsRegistry();
        const done = cnsCollateral<{ id: number }>();
        const failed = cnsCollateral<{ id: number }>();

        registry.register('charge', cnsNeuron({ done, failed }), { failed: 'charge-failed' });

        expect(registry.getCollateralName(done)).toBe('charge.done');
        expect(registry.getCollateralName(failed)).toBe('charge-failed');
    });

    it('refuses a name for a key the axon does not have, and leaves nothing half-registered', () => {
        const registry = new CNSPersistOptionsRegistry();
        const done = cnsCollateral<{ id: number }>();
        const charge = cnsNeuron({ done });

        expect(() => registry.register('charge', charge, { dnoe: 'x' } as never)).toThrow(
            'cannot name collateral "dnoe" of neuron "charge": its axon has no such key'
        );
        registry.registerCollateral('taken', cnsCollateral<{ id: number }>());
        expect(() => registry.register('charge', charge, { done: 'taken' })).toThrow('another collateral has this name');
        expect(registry.getNeuron('charge')).toBeUndefined();
        expect(registry.getCollateralName(done)).toBeUndefined();

        const failed = cnsCollateral<{ id: number }>();
        const twin = cnsNeuron({ done, failed });
        expect(() => registry.register('twin', twin, { done: 'same', failed: 'same' })).toThrow('two of its collaterals share "same"');
        expect(registry.getNeuron('twin')).toBeUndefined();
    });

    it('is unaffected by how many other collaterals are registered', () => {
        // The property the walk did not have: an answer that does not depend on
        // the size of the registry.
        const registry = new CNSPersistOptionsRegistry();
        const wanted = cnsCollateral<{ id: number }>();
        registry.registerCollateral('wanted', wanted);
        for (let index = 0; index < 500; index++)
            registry.registerCollateral(
                `other${index}`,
                cnsCollateral<{ id: number }>()
            );

        expect(registry.getCollateralName(wanted)).toBe('wanted');
    });

    it('still resolves a neuron by identity', () => {
        const registry = new CNSPersistOptionsRegistry();
        const out = cnsCollateral<{ ok: boolean }>();
        const worker = cnsNeuron({ out }).dendrite({
            collateral: out,
            response: () => undefined,
        });

        registry.register('worker', worker);

        expect(registry.getNeuronName(worker as never)).toBe('worker');
        expect(registry.getNeuron('worker')).toBe(worker);
    });
});
