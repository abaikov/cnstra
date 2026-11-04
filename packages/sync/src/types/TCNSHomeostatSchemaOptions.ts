import type { ICNSHomeostatModelDefinition } from '../interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatNeuronDependencies } from './TCNSHomeostatNeuronDependencies';
import type { TCNSHomeostatNeuronFactory } from './TCNSHomeostatNeuronFactory';

export type TCNSHomeostatSchemaOptions<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    THandles extends ICNSHomeostatModelHandles,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>> = Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>>,
> = {
    readonly homeostatModels: TModels;
    readonly neuronFactories?: {
        readonly [TNeuronName in keyof TNeurons]: (dependencies: TCNSHomeostatNeuronDependencies<TModels, THandles>) => TNeurons[TNeuronName];
    };
};
