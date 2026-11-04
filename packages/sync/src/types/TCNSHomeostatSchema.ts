import type { createCNS } from '@cnstra/core';
import type { ICNSHomeostatModelDefinition } from '../interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModels } from './TCNSHomeostatModels';
import type { TCNSHomeostatNeuronFactory } from './TCNSHomeostatNeuronFactory';
import type { TCNSHomeostatNeurons } from './TCNSHomeostatNeurons';

export type TCNSHomeostatSchema<
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    THandles extends ICNSHomeostatModelHandles,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>> = Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>>,
> = TCNSHomeostatModels<TModels, THandles> & {
    readonly cns: ReturnType<typeof createCNS>;
    readonly homeostatEnvironment: THandles['homeostatEnvironment'];
    readonly homeostatNeurons: TCNSHomeostatNeurons;
    readonly neurons: TNeurons;
    dispose(): void;
};
