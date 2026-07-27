import type { ICNSCollateral, TCNSNeuron } from '@cnstra/types';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import type { TCNSNeuronRegistryEntry } from './types/TCNSNeuronRegistryEntry';
import type { TCNSRegistryValue } from './types/TCNSRegistryValue';

/**
 * Builds a {@link CNSPersistOptionsRegistry} from a plain object of named neurons.
 * All axon collaterals of each neuron are registered automatically. Use this for
 * both production persistence and devtools/AI inspection — one registry serves both.
 *
 * @example
 * import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
 * export const registry = CNSPersistOptionsRegistryFactory.create({ deckNeuron, cardNeuron });
 *
 * // Explicit collateral names (type-checked against the neuron's axon):
 * export const registry = CNSPersistOptionsRegistryFactory.create({
 *   'deck-neuron': { neuron: deckNeuron, collaterals: { deckCreated: 'deck-created' } }
 * });
 */
export class CNSPersistOptionsRegistryFactory {
    static create<TMap extends Record<string, TCNSNeuron<any, any>>>(
        namedNeurons: { [K in keyof TMap]: TCNSRegistryValue<TMap[K]> }
    ): CNSPersistOptionsRegistry {
        const registry = new CNSPersistOptionsRegistry();
        for (const [name, entry] of Object.entries(namedNeurons)) {
            const isEntry =
                'neuron' in (entry as object) && !('axon' in (entry as object));
            const neuron = isEntry
                ? (entry as TCNSNeuronRegistryEntry).neuron
                : (entry as TCNSNeuron<any, any>);
            const colNames = isEntry
                ? ((entry as TCNSNeuronRegistryEntry).collaterals ?? {})
                : {};

            registry.addNeuron(neuron, { name, neuron });
            for (const [key, col] of Object.entries(neuron.axon)) {
                registry.addCollateral(col as ICNSCollateral<unknown>, {
                    name: (colNames as Record<string, string>)[key] ?? key,
                    collateral: col as ICNSCollateral<unknown>,
                });
            }
        }
        return registry;
    }
}
