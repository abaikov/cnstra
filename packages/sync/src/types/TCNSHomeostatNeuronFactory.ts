import type { createCNS } from '@cnstra/core';
import type { ICNSHomeostatModelDefinition } from '../interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatNeuronDependencies } from './TCNSHomeostatNeuronDependencies';

export type TCNSHomeostatNeuronFactory<TModels extends Record<string, ICNSHomeostatModelDefinition>, THandles extends ICNSHomeostatModelHandles> =
    Parameters<typeof createCNS<TCNSHomeostatNeuronDependencies<TModels, THandles>>>[0][number];
