import { CNS } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSPersistOptionsRegistryFactory,
} from '@cnstra/persist';
import type {
    TCNSNeuronRegistryEntry,
    TCNSRegistryValue,
} from '@cnstra/persist';
import type { TCNSNeuron, TCNSOptions } from '@cnstra/types';

/**
 * Composition helper that builds a CNS and its CNSPersistOptionsRegistry from a
 * single plain object of named neurons — the one place the engine (@cnstra/core)
 * and the persistence layer (@cnstra/persist) are combined.
 *
 * @example
 * import { CNSFactory } from '@cnstra/factory';
 * export const { cns, registry } = CNSFactory.create({ deckNeuron, cardNeuron });
 */
export class CNSFactory {
    static create<
        TMap extends Record<string, TCNSNeuron<any, any>>,
        TGlobal = undefined
    >(
        namedNeurons: { [K in keyof TMap]: TCNSRegistryValue<TMap[K]> },
        options?: TCNSOptions & { global?: TGlobal }
    ): {
        cns: CNS<TCNSNeuron<any, any>>;
        registry: CNSPersistOptionsRegistry;
    } {
        const neurons = Object.values(namedNeurons).map(entry =>
            entry && typeof entry === 'object' && 'neuron' in (entry as object)
                ? (entry as TCNSNeuronRegistryEntry).neuron
                : (entry as TCNSNeuron<any, any>)
        );
        const cns = new CNS(neurons, options, options?.global);
        const registry = CNSPersistOptionsRegistryFactory.create(namedNeurons);
        return { cns, registry };
    }
}
