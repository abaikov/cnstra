import type { TCNSAxon, TCNSNeuron } from '@cnstra/types';

/** A named-neuron entry with optional explicit collateral names for the registry. */
export type TCNSNeuronRegistryEntry<TAxon extends TCNSAxon = TCNSAxon> = {
    neuron: TCNSNeuron<any, TAxon>;
    collaterals?: { [K in keyof TAxon]?: string };
};
