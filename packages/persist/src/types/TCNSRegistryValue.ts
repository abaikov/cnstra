import type { TCNSNeuron } from '@cnstra/types';

/** A registry map value: a bare neuron, or a neuron with explicit collateral names. */
export type TCNSRegistryValue<N extends TCNSNeuron<any, any>> =
    | N
    | (N extends TCNSNeuron<any, infer TAxon>
          ? { neuron: N; collaterals?: { [K in keyof TAxon]?: string } }
          : never);
