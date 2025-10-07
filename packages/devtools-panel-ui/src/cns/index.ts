import { CNS } from '@cnstra/core';
import { appIngressNeuron } from './controller-layer/AppIngressNeuron';
import { appsNeuron } from './data-layer/app/AppsNeuron';
import { neuronNeuron } from './data-layer/neuron/NeuronNeuron';
import { collateralNeuron } from './data-layer/collateral/CollateralNeuron';
import { dendriteNeuron } from './data-layer/dendrite/DendriteNeuron';
import { responsesNeuron } from './data-layer/response/ResponsesNeuron';
import { stimulationNeuron } from './data-layer/stimulation/StimulationNeuron';
import { wsNeuron } from './ws/WsNeuron';

export const mainCNS = new CNS([
    wsNeuron,
    appIngressNeuron,
    appsNeuron,
    neuronNeuron,
    collateralNeuron,
    dendriteNeuron,
    responsesNeuron,
    stimulationNeuron,
]);
