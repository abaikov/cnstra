import { StimulationId } from './Stimulation';
import { DevToolsAppId } from './DevToolsApp';

export type StimulationResponseId = string;

/**
 * Represents a neuron's response to a stimulation.
 *
 * This is the complete data model for responses, including all fields
 * needed for storage, querying, and visualization. Contains full hop-by-hop
 * information about signal processing.
 *
 * @see NeuronResponseMessage - transport wrapper (should eventually just use this)
 * @see ResponseBatchMessage - batch transport wrapper
 */
export interface StimulationResponse {
    /** Unique identifier for this response */
    responseId: StimulationResponseId;
    /** ID of the stimulation that triggered this response */
    stimulationId: StimulationId;
    /** Application this response belongs to */
    appId: DevToolsAppId;
    /** CNS instance identifier (format: `${appId}:${cnsName}`) */
    cnsId: string;
    /** When this response occurred */
    timestamp: number;
    /** Name of the input collateral that triggered this response */
    inputCollateralName: string;
    /** Name of the output collateral produced by this response */
    outputCollateralName?: string;
    /** Optional hop index in the stimulation path (0-based) */
    hopIndex?: number;
    /** Context data associated with this response */
    contexts?: Record<string, unknown>;
    /** Input payload received by the neuron */
    inputPayload?: unknown;
    /** Output payload produced by the neuron */
    outputPayload?: unknown;
    /** Response payload (may be same as outputPayload, kept for compatibility) */
    responsePayload?: unknown;
    /** Error message if processing failed */
    error?: string;
    /** Processing duration in milliseconds */
    duration?: number;
}
