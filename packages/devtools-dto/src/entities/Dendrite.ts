import { DevToolsAppId } from './DevToolsApp';
import { NeuronId } from './Neuron';
import type { CNSId } from './CNSInstance';

export type DendriteId = string;

/**
 * Represents a dendrite in the CNStra neural network.
 *
 * Dendrites are input channels that neurons use to receive signals from collaterals.
 * The neuronId field indicates which neuron OWNS this dendrite (i.e., which neuron
 * will receive signals when this collateral is stimulated).
 * The name field indicates which collateral this dendrite listens to.
 *
 * ID Format: `${neuronId}:d:${collateralName}` (e.g., "myApp:core:userService:d:user-created")
 *
 * To build neural network connections:
 * - Use Collateral.neuronId to find which neuron owns each collateral (signal source)
 * - Use Dendrite.name + Dendrite.neuronId to find which neurons listen to each collateral (signal destination)
 * - Connect: Collateral owner → Dendrite listener
 *
 * @see Neuron - the entity that owns this dendrite
 * @see Collateral - the collateral this dendrite listens to
 */
export interface Dendrite {
    /** Unique identifier for this dendrite (format: `${neuronId}:d:${name}`) */
    id: DendriteId;
    /** ID of the neuron that owns this dendrite (will receive signals) */
    neuronId: NeuronId;
    /** Application this dendrite belongs to */
    appId: DevToolsAppId;
    /** CNS instance */
    cnsId: CNSId;
    /** Name of the collateral this dendrite listens to */
    name: string;
}
