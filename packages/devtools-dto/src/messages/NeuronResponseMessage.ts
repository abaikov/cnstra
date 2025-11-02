import { StimulationResponse } from '../entities/StimulationResponse';

/**
 * Transport message for neuron responses.
 *
 * This is a direct alias of StimulationResponse - no additional fields needed.
 * Kept as separate type for backwards compatibility and semantic clarity in transport layer.
 *
 * TODO: Consider deprecating this in favor of using StimulationResponse directly.
 *
 * @see StimulationResponse - the actual data model
 */
export type NeuronResponseMessage = StimulationResponse;
