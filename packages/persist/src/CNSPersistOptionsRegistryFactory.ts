import type { ICNSCollateral, TCNSModality, TCNSNeuron } from '@cnstra/types';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import type { TCNSNeuronRegistryEntry } from './types/TCNSNeuronRegistryEntry';
import type { TCNSRegistryNamespace } from './types/TCNSRegistryNamespace';

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const isNeuron = (value: unknown): value is TCNSNeuron =>
    isObject(value) && isObject(value.axon) && Array.isArray(value.dendrites);

const isCollateral = (value: unknown): value is ICNSCollateral<unknown> =>
    isObject(value) && typeof value.createSignal === 'function';

const isModality = (value: unknown): value is TCNSModality =>
    isObject(value) && typeof value.index === 'number' && isObject(value.afferentPaths);

const isEntry = (value: unknown): value is TCNSNeuronRegistryEntry =>
    isObject(value) &&
    isNeuron(value.neuron) &&
    Object.keys(value).every(key => key === 'neuron' || key === 'collaterals');

const isNamespace = (value: unknown): value is Record<string, unknown> => {
    if (!isObject(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

/**
 * Builds a {@link CNSPersistOptionsRegistry} from a plain object of named neurons,
 * collaterals and modalities. Every axon collateral of a neuron is registered as
 * `<neuron name>.<axon key>`, also when it is listed in the object itself; only a
 * collateral no listed neuron owns takes its own key. A nested plain object is a
 * namespace: its key and a dot prefix every name inside it, so a library graph
 * keeps its own names.
 *
 * @example
 * import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
 * export const registry = CNSPersistOptionsRegistryFactory.create({
 *   deckNeuron,
 *   cardCreated,
 *   payments: createPaymentsGraph(deps),
 * });
 *
 * // Explicit collateral names (type-checked against the neuron's axon):
 * export const registry = CNSPersistOptionsRegistryFactory.create({
 *   deckNeuron: { neuron: deckNeuron, collaterals: { deckCreated: 'deck-created' } }
 * });
 */
export class CNSPersistOptionsRegistryFactory {
    static create<TNamespace extends object>(
        namespace: TNamespace & TCNSRegistryNamespace<TNamespace>
    ): CNSPersistOptionsRegistry {
        const registry = new CNSPersistOptionsRegistry();
        const collateralsAndModalities: Array<[string, unknown]> = [];
        CNSPersistOptionsRegistryFactory.registerNeurons(registry, namespace, '', collateralsAndModalities);
        const owned = new Set<unknown>();
        for (const neuron of registry.getNamedNeurons().values())
            for (const collateral of Object.values(neuron.axon)) owned.add(collateral);
        for (const [name, value] of collateralsAndModalities) {
            if (isModality(value)) registry.registerModality(name, value);
            else if (!owned.has(value)) registry.registerCollateral(name, value as ICNSCollateral<unknown>);
        }
        return registry;
    }

    private static registerNeurons(
        registry: CNSPersistOptionsRegistry,
        namespace: object,
        prefix: string,
        collateralsAndModalities: Array<[string, unknown]>
    ): void {
        for (const [key, value] of Object.entries(namespace)) {
            const name = `${prefix}${key}`;
            if (isNeuron(value)) registry.register(name, value);
            else if (isEntry(value))
                registry.register(name, value.neuron, CNSPersistOptionsRegistryFactory.prefixed(value.collaterals, prefix));
            else if (isCollateral(value) || isModality(value)) collateralsAndModalities.push([name, value]);
            else if (isNamespace(value))
                CNSPersistOptionsRegistryFactory.registerNeurons(registry, value, `${name}.`, collateralsAndModalities);
            else
                throw new Error(
                    `"${name}" is not a neuron, a { neuron, collaterals } entry, a collateral, a modality or a namespace object`
                );
        }
    }

    private static prefixed(
        collateralNames: Record<string, string | undefined> | undefined,
        prefix: string
    ): Record<string, string> {
        const names: Record<string, string> = {};
        for (const [key, name] of Object.entries(collateralNames ?? {}))
            if (name !== undefined) names[key] = `${prefix}${name}`;
        return names;
    }
}
