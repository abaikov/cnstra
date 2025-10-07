import { NeuronResponseMessage } from '../messages/NeuronResponseMessage';

export interface ResponseBatchMessage {
    type: 'neuron-response-batch' | 'response-batch';
    responses: NeuronResponseMessage[];
}
