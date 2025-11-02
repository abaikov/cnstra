import { DevToolsAppId } from './DevToolsApp';
import { NeuronId } from './Neuron';

export type StimulationId = string;

/**
 * Represents a stimulation event in the CNStra neural network.
 *
 * This is the complete data model for stimulations, including all fields
 * needed for storage, querying, and visualization.
 *
 * @see StimulationMessage - transport wrapper that adds runtime-only fields
 */
export interface Stimulation {
    /** Unique identifier for this stimulation */
    stimulationId: StimulationId;
    /** Application this stimulation belongs to */
    appId: DevToolsAppId;
    /** CNS instance identifier (format: `${appId}:${cnsName}`) */
    cnsId: string;
    /** ID of the neuron that initiated this stimulation */
    neuronId: NeuronId;
    /** Name of the collateral this stimulation was sent on */
    collateralName: string;
    /** When this stimulation occurred */
    timestamp: number;
    /** Optional payload data */
    payload?: unknown;
}
