import type { TCNSNeuron } from '@cnstra/types';
import type { TCNSNeuronRegistryEntry } from './TCNSNeuronRegistryEntry';

/**
 * A registry map value: a bare neuron, or a {@link TCNSNeuronRegistryEntry} (a neuron
 * with explicit collateral names). The object arm reuses the entry type — no shape dup.
 */
export type TCNSRegistryValue<N extends TCNSNeuron<any>> =
    | N
    | (N extends TCNSNeuron<infer TAxon>
          ? TCNSNeuronRegistryEntry<TAxon>
          : never);
