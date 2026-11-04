import type { OIMDB } from '@oimdb/core';
import { assembleCNSHomeostatSchema } from '@cnstra/sync';
import type { ICNSHomeostatModelDefinition, TCNSHomeostatNeuronFactory } from '@cnstra/sync';
import { CNSOIMDBHomeostatModelBinding } from '../CNSOIMDBHomeostatModelBinding';
import type { ICNSOIMDBHomeostatModelHandles } from '../interfaces/ICNSOIMDBHomeostatModelHandles';
import type { TCNSOIMDBHomeostatSchema } from '../types/TCNSOIMDBHomeostatSchema';
import type { TCNSOIMDBHomeostatSchemaOptions } from '../types/TCNSOIMDBHomeostatSchemaOptions';

export function createCNSOIMDBHomeostatSchema<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, ICNSOIMDBHomeostatModelHandles>>>,
>(
    db: OIMDB,
    options: TCNSOIMDBHomeostatSchemaOptions<TModels, TNeurons>
): TCNSOIMDBHomeostatSchema<TModels, TNeurons> {
    return assembleCNSHomeostatSchema<ICNSOIMDBHomeostatModelHandles, TModels, TNeurons>(new CNSOIMDBHomeostatModelBinding(db, options.homeostatEnvironmentOptions), options);
}
