import { DevToolsAppId } from './DevToolsApp';

export type StimulationId = string;

/**
 * Represents a stimulation event in the CNStra neural network.
 *
 * This is the stored entity version with core stimulation data.
 * For real-time messaging, see StimulationMessage which includes
 * additional runtime fields like queueLength, hops, and error.
 *
 * @see StimulationMessage - for real-time messaging with runtime data
 */
export interface Stimulation {
    /** Unique identifier for this stimulation */
    stimulationId: StimulationId;
    /** Application/CNS this stimulation belongs to */
    cnsId: string; // `${appId}:${cnsName}`
    originalId: string; // raw id from core
    /** When this stimulation occurred */
    timestamp: number;
}
