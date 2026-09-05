import type { TCNSAxon, TCNSNeuron } from '@cnstra/types';
import type { TCNSCollateralNameMap } from './TCNSCollateralNameMap';

/** A named-neuron entry with optional explicit collateral names for the registry. */
export type TCNSNeuronRegistryEntry<TAxon extends TCNSAxon = TCNSAxon> = {
    neuron: TCNSNeuron<TAxon>;
    collaterals?: TCNSCollateralNameMap<TAxon>;
};
