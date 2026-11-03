import { CNS } from '@cnstra/core';
import { appIngressNeuron } from './controller-layer/AppIngressNeuron';
import { appsNeuron } from './data-layer/app/AppsNeuron';
import { wsNeuron } from './ws/WsNeuron';

export const mainCNS = new CNS([wsNeuron, appIngressNeuron, appsNeuron]);
