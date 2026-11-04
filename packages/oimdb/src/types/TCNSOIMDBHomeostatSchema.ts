import type { ICNSHomeostatModelDefinition, TCNSHomeostatNeuronFactory, TCNSHomeostatSchema } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatModelHandles } from '../interfaces/ICNSOIMDBHomeostatModelHandles';

export type TCNSOIMDBHomeostatSchema<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSOIMDBHomeostatModelHandles>>> =
        Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSOIMDBHomeostatModelHandles>>>,
> = TCNSHomeostatSchema<TModels, ICNSOIMDBHomeostatModelHandles, TNeurons>;
