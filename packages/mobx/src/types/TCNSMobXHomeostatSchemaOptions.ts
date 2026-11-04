import type {
    ICNSHomeostatModelDefinition,
    TCNSHomeostatEnvironmentFactoryOptions,
    TCNSHomeostatFiringPolicyOptions,
    TCNSHomeostatNeuronFactory,
    TCNSHomeostatSchemaOptions,
} from '@cnstra/sync';
import type { ICNSMobXHomeostatModelHandles } from '../interfaces/ICNSMobXHomeostatModelHandles';

export type TCNSMobXHomeostatSchemaOptions<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSMobXHomeostatModelHandles>>> =
        Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSMobXHomeostatModelHandles>>>,
> = TCNSHomeostatSchemaOptions<TModels, ICNSMobXHomeostatModelHandles, TNeurons> & {
    readonly homeostatEnvironmentOptions?: Omit<TCNSHomeostatEnvironmentFactoryOptions & TCNSHomeostatFiringPolicyOptions, 'cns'>;
};
