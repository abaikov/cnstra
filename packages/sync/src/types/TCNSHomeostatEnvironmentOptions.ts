import type { TCNSHomeostatCNS } from './TCNSHomeostatCNS';
import type { TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';
import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { CNSHomeostatRegulator } from '../CNSHomeostatRegulator';
import type { ICNSHomeostatCorrectionRepository } from '../interfaces/ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from '../interfaces/ICNSHomeostatFiringPolicy';
import type { ICNSHomeostatRefetchPolicy } from '../interfaces/ICNSHomeostatRefetchPolicy';
import type { TCNSHomeostatRegulatorOptions } from './TCNSHomeostatRegulatorOptions';

export type TCNSHomeostatEnvironmentOptions<
    TFiringPolicy extends ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]>,
> = {
    cns: TCNSHomeostatCNS;
    homeostatFiringPolicy: TFiringPolicy;
    createHomeostatCorrectionRepository: (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => TCorrectionRepository;
    createHomeostatRegulator: <TKey extends readonly unknown[], TData>(options: TCNSHomeostatRegulatorOptions<TKey, TData>) => CNSHomeostatRegulator<TKey, TData>;
    createHomeostatRefetchPolicy: (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => ICNSHomeostatRefetchPolicy;
    stimulationOptionsOf: (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => TCNSStimulationOptions<TCNSStimulationResponse> | undefined;
    getNowMs: () => number;
    keyHashFn: (key: readonly unknown[]) => string;
    runUntracked: (run: () => void) => void;
    runInTransaction: <TResult>(run: () => TResult) => TResult;
    runWrite: (write: () => void) => void;
    scheduleRefetchAt: (homeostatCorrectionRepository: TCorrectionRepository, keyHash: string, refetchAtMs: number, refetch: () => void) => (() => void) | void;
};
