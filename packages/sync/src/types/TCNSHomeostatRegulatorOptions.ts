import type { TCNSHomeostatCNS } from './TCNSHomeostatCNS';
import type { TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';
import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { ICNSHomeostatCorrectionRepository } from '../interfaces/ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from '../interfaces/ICNSHomeostatFiringPolicy';
import type { ICNSHomeostatRefetchPolicy } from '../interfaces/ICNSHomeostatRefetchPolicy';

export type TCNSHomeostatRegulatorOptions<TKey extends readonly unknown[], TData> = {
    homeostatReceptor: CNSHomeostatReceptor<TKey, TData>;
    cns: TCNSHomeostatCNS;
    homeostatCorrectionRepository: ICNSHomeostatCorrectionRepository<readonly unknown[]>;
    homeostatFiringPolicy: ICNSHomeostatFiringPolicy;
    homeostatRefetchPolicy: ICNSHomeostatRefetchPolicy;
    stimulationOptions: TCNSStimulationOptions<TCNSStimulationResponse> | undefined;
    getNowMs: () => number;
    keyHashFn: (key: readonly unknown[]) => string;
    runUntracked: (run: () => void) => void;
    runInTransaction: <TResult>(run: () => TResult) => TResult;
    scheduleRefetchAt: (keyHash: string, refetchAtMs: number, refetch: () => void) => (() => void) | void;
};
