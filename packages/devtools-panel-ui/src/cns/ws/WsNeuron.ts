import { neuron } from '@cnstra/core';
import { wsAxon } from './WsAxon';

export const wsNeuron = neuron('ws-neuron', wsAxon);
