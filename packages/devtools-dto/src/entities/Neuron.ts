import { DevToolsAppId } from './DevToolsApp';
import type { CNSId } from './CNSInstance';

export type NeuronId = string;

/**
 * Represents a neuron in the CNStra neural network.
 *
 * Note: Axon collateral ownership is NOT stored in this entity.
 * Instead, collateral ownership is represented separately via the Collateral entity,
 * where Collateral.neuronId indicates which neuron owns that collateral.
 *
 * @see Collateral - for axon collateral ownership relationships
 * @see Dendrite - for input collateral listening relationships
 */
export interface Neuron {
    /** Unique identifier for this neuron */
    id: NeuronId;
    /** Application this neuron belongs to */
    appId: DevToolsAppId;
    /** CNS instance */
    cnsId: CNSId;
    /** Human-readable name of the neuron */
    name: string;
}
