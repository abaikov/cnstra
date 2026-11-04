import type { ICNSHomeostatModelDefinition, TCNSHomeostatNeuronFactory, TCNSHomeostatSchema } from '@cnstra/sync';
import type { ICNSMobXHomeostatModelHandles } from '../interfaces/ICNSMobXHomeostatModelHandles';

export type TCNSMobXHomeostatSchema<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSMobXHomeostatModelHandles>>> =
        Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSMobXHomeostatModelHandles>>>,
> = TCNSHomeostatSchema<TModels, ICNSMobXHomeostatModelHandles, TNeurons>;
