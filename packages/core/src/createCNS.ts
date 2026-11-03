import type { TCNSNeuron, TCNSOptions } from '@cnstra/types';
import { CNS } from './CNS';

export const createCNS = <TDependencies>(
    neuronFactories: readonly ((dependencies: TDependencies) => TCNSNeuron<any>)[],
    dependencies: TDependencies,
    options?: TCNSOptions
): CNS<TCNSNeuron<any>> => {
    if (new Set(neuronFactories).size !== neuronFactories.length) {
        throw new Error('createCNS: a neuron factory is listed twice; every dendrite of its neuron would run twice');
    }
    return new CNS(neuronFactories.map(createNeuron => createNeuron(dependencies)), options);
};
