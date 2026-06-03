import { StimulationResponse } from '../entities/StimulationResponse';

/**
 * Transport message for neuron responses.
 *
 * This is a direct alias of StimulationResponse. Both types are kept:
 * - `NeuronResponseMessage` is used in transport-layer code (sendNeuronResponseMessage,
 *   ResponseBatchMessage.responses) and provides semantic clarity at the wire level.
 * - `StimulationResponse` is used in storage and query code.
 *
 * They share the same shape intentionally so that a message received over the wire
 * can be saved to the repository without conversion.
 *
 * @see StimulationResponse - the storage/query data model
 */
export type NeuronResponseMessage = StimulationResponse;
