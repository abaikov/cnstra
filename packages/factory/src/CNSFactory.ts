import { CNS } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSPersistOptionsRegistryFactory,
} from '@cnstra/persist';
import type { TCNSRegistryNamespace } from '@cnstra/persist';
import type { TCNSNeuron, TCNSOptions } from '@cnstra/types';

/**
 * Composition helper that builds a CNS and its CNSPersistOptionsRegistry from a
 * single plain object of named neurons — the one place the engine (@cnstra/core)
 * and the persistence layer (@cnstra/persist) are combined. Nested objects are
 * namespaces, as in `CNSPersistOptionsRegistryFactory.create`.
 *
 * @example
 * import { CNSFactory } from '@cnstra/factory';
 * export const { cns, registry } = CNSFactory.create({ deckNeuron, cardNeuron, payments: createPaymentsGraph(deps) });
 */
export class CNSFactory {
    static create<TNamespace extends object, TGlobal = undefined>(
        namespace: TNamespace & TCNSRegistryNamespace<TNamespace>,
        options?: TCNSOptions & { global?: TGlobal }
    ): {
        cns: CNS<TCNSNeuron<any>>;
        registry: CNSPersistOptionsRegistry;
    } {
        const registry = CNSPersistOptionsRegistryFactory.create(namespace);
        const cns = new CNS([...registry.getNamedNeurons().values()], options, options?.global);
        return { cns, registry };
    }
}
