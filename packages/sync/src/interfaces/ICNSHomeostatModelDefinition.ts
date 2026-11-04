import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { ICNSHomeostatModelBinding } from './ICNSHomeostatModelBinding';
import type { ICNSHomeostatModelHandles } from './ICNSHomeostatModelHandles';
import type { createCNS } from '@cnstra/core';

export interface ICNSHomeostatModelDefinition {
    readonly homeostatReceptors: readonly CNSHomeostatReceptor<never, unknown>[];
    createModel<THandles extends ICNSHomeostatModelHandles>(
        binding: ICNSHomeostatModelBinding<THandles>,
        homeostatEnvironment: THandles['homeostatEnvironment']
    ): { readonly homeostatDendrites: readonly unknown[]; createNeuron(): ReturnType<Parameters<typeof createCNS<unknown>>[0][number]> };
}
