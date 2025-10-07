import { DevToolsAppId } from '../entities/DevToolsApp';
import { NeuronId } from '../entities/Neuron';
import { StimulationId } from '../entities/Stimulation';

export interface NeuronResponseMessage {
    stimulationId: StimulationId;
    neuronId: NeuronId;
    appId: DevToolsAppId;
    collateralName: string;
    /** Optional: name of input collateral that triggered this response */
    inputCollateralName?: string;
    /** Optional: name of output collateral produced by this response */
    outputCollateralName?: string;
    timestamp: number;
    payload?: unknown;
    contexts?: Record<string, unknown>;
    responsePayload?: unknown;
    error?: string;
    duration?: number;
    /** Optional hop index in the stimulation path (0-based). Not always available. */
    hopIndex?: number;
}
