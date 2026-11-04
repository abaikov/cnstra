import type { ICNSHomeostatModelDefinition, TCNSHomeostatNeuronFactory, TCNSHomeostatSchemaOptions } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatModelHandles } from '../interfaces/ICNSOIMDBHomeostatModelHandles';
import type { TCNSOIMDBHomeostatEnvironmentFactoryOptions } from './TCNSOIMDBHomeostatEnvironmentFactoryOptions';

export type TCNSOIMDBHomeostatSchemaOptions<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSOIMDBHomeostatModelHandles>>> =
        Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSOIMDBHomeostatModelHandles>>>,
> = TCNSHomeostatSchemaOptions<TModels, ICNSOIMDBHomeostatModelHandles, TNeurons> & {
    readonly homeostatEnvironmentOptions?: Omit<TCNSOIMDBHomeostatEnvironmentFactoryOptions, 'db' | 'cns'>;
};
