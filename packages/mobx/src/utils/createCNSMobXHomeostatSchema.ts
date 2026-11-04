import { assembleCNSHomeostatSchema } from '@cnstra/sync';
import type { ICNSHomeostatModelDefinition, TCNSHomeostatNeuronFactory } from '@cnstra/sync';
import { CNSMobXHomeostatModelBinding } from '../CNSMobXHomeostatModelBinding';
import type { ICNSMobXHomeostatModelHandles } from '../interfaces/ICNSMobXHomeostatModelHandles';
import type { TCNSMobXHomeostatSchema } from '../types/TCNSMobXHomeostatSchema';
import type { TCNSMobXHomeostatSchemaOptions } from '../types/TCNSMobXHomeostatSchemaOptions';

export function createCNSMobXHomeostatSchema<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSMobXHomeostatModelHandles>>>,
>(
    options: TCNSMobXHomeostatSchemaOptions<TModels, TNeurons>
): TCNSMobXHomeostatSchema<TModels, TNeurons> {
    return assembleCNSHomeostatSchema<ICNSMobXHomeostatModelHandles, TModels, TNeurons>(new CNSMobXHomeostatModelBinding(options.homeostatEnvironmentOptions), options);
}
