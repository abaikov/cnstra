import { DevToolsAppId } from '../entities/DevToolsApp';

/**
 * Real-time stimulation message sent over DevTools protocol.
 *
 * This differs from the Stimulation entity by including runtime
 * information like queue length, hop count, and errors that are
 * relevant for live monitoring but not for stored data.
 *
 * @see Stimulation - for stored entity version without runtime data
 */
export interface StimulationMessage {
    /** Message type discriminator */
    type: 'stimulation';
    /** Application this stimulation belongs to */
    appId: DevToolsAppId;
    /** Unique identifier for this stimulation */
    stimulationId: string;
    /** When this stimulation occurred */
    timestamp: number;
    /** ID of the neuron that initiated this stimulation */
    neuronId: string;
    /** Name of the collateral this stimulation was sent on */
    collateralName: string;
    /** Data payload of the stimulation */
    payload?: unknown;
    /** Number of stimulations in the processing queue (runtime info) */
    queueLength: number;
    /** Number of hops this stimulation has taken (runtime info) */
    hops?: number;
    /** Error information if stimulation failed (runtime info) */
    error?: unknown;
}