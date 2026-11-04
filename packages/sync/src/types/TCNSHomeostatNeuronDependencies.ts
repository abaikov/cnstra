import type { ICNSHomeostatModelDefinition } from '../interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModels } from './TCNSHomeostatModels';

export type TCNSHomeostatNeuronDependencies<TModels extends Record<string, ICNSHomeostatModelDefinition>, THandles extends ICNSHomeostatModelHandles> =
    TCNSHomeostatModels<TModels, THandles> & {
        readonly homeostatEnvironment: THandles['homeostatEnvironment'];
    };
