import type { TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';
import type { TCNSHomeostatRefractoryPolicy } from './TCNSHomeostatRefractoryPolicy';

export type TCNSHomeostatReceptorOptions<TKey, TData> = {
    name: string;
    transduce?: (key: TKey, abortSignal: AbortSignal) => Promise<TData>;
    staleTimeMs?: number;
    homeostatRefractoryPolicy?: TCNSHomeostatRefractoryPolicy;
    stimulationOptions?: TCNSStimulationOptions<TCNSStimulationResponse>;
};
