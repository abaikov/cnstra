import { DevToolsAppId } from './DevToolsApp';
import { NeuronId } from './Neuron';
import type { CNSId } from './CNSInstance';

export type CollateralId = string;

/**
 * Represents an axon collateral in the CNStra neural network.
 *
 * Collaterals are output channels that neurons use to send signals.
 * The neuronId field indicates which neuron OWNS this collateral (i.e., which neuron
 * can send signals on this collateral).
 *
 * ID Format: `${neuronId}:${collateralName}` (e.g., "myApp:core:userService:user-created")
 *
 * To build neural network connections:
 * - Use Collateral.neuronId to find which neuron owns each collateral (signal source)
 * - Use Dendrite.name to find which neurons listen to each collateral (signal destination)
 * - Connect: Collateral owner → Dendrite listener
 *
 * @see Neuron - the entity that owns this collateral
 * @see Dendrite - entities that listen to this collateral
 */
export interface Collateral {
    /** Unique identifier for this collateral (format: `${neuronId}:${name}`) */
    id: CollateralId;
    /** Name of the collateral */
    name: string;
    /** ID of the neuron that owns this collateral (can send signals on it) */
    neuronId: NeuronId;
    /** Application this collateral belongs to */
    appId: DevToolsAppId;
    /** CNS instance */
    cnsId: CNSId;
}
