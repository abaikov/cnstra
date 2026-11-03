import type { ICNSCollateral, TCNSModality, TCNSNeuron } from '@cnstra/types';
import type { TCNSNeuronRegistryEntry } from './TCNSNeuronRegistryEntry';

export type TCNSRegistryNamespace<TNamespace> = {
    [K in keyof TNamespace]: TNamespace[K] extends TCNSNeuron<any> | ICNSCollateral<any> | TCNSModality
        ? TNamespace[K]
        : TNamespace[K] extends { neuron: TCNSNeuron<infer TAxon>; collaterals?: infer TNames }
          ? TCNSNeuronRegistryEntry<TAxon> & {
                collaterals?: { [N in keyof TNames]: N extends keyof TAxon ? string : never };
            }
          : TCNSRegistryNamespace<TNamespace[K]>;
};
