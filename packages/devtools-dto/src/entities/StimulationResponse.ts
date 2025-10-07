import { StimulationId } from './Stimulation';

export type StimulationResponseId = string;

export interface StimulationResponse {
    responseId: StimulationResponseId;
    stimulationId: StimulationId;
    timestamp: number;
    responsePayload?: unknown;
    error?: string;
    duration?: number;
}
