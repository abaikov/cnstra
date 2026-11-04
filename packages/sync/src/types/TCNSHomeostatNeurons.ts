import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { CNSHomeostatReceptorCorrection } from '../CNSHomeostatReceptorCorrection';

export type TCNSHomeostatNeurons = {
    readonly homeostatReceptorCorrection: CNSHomeostatReceptorCorrection['neuron'];
    readonly homeostatReceptors: readonly CNSHomeostatReceptor<never, unknown>['neuron'][];
};
