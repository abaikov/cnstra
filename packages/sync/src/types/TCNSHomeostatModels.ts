import type { ICNSCollateral } from '@cnstra/types';
import type { CNSHomeostatModelDefinition } from '../CNSHomeostatModelDefinition';
import type { ICNSHomeostatModelDefinition } from '../interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModel } from './TCNSHomeostatModel';

export type TCNSHomeostatModels<TModels extends Record<string, ICNSHomeostatModelDefinition>, THandles extends ICNSHomeostatModelHandles> = {
    readonly [TModelName in keyof TModels]: TModels[TModelName] extends CNSHomeostatModelDefinition<
        infer TAxon extends Record<string, ICNSCollateral<unknown>>,
        infer TCollections extends Record<string, object>,
        infer TReceptors extends Record<string, unknown>
    > ? TCNSHomeostatModel<TAxon, TCollections, TReceptors, THandles> : never;
};
