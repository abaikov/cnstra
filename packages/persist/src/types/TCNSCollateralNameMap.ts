import type { TCNSAxon } from '@cnstra/types';

/**
 * Per-axon-key override of a collateral's registry name: for a neuron whose axon
 * has keys `K`, an optional map `{ [K]?: string }` naming each output collateral.
 * Shared by {@link TCNSNeuronRegistryEntry} and `CNSPersistOptionsRegistry.register`
 * so the shape is single-sourced.
 */
export type TCNSCollateralNameMap<TAxon extends TCNSAxon> = {
    [K in keyof TAxon]?: string;
};
