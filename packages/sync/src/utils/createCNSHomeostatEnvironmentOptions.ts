import { CNSHomeostatStaleTimeRefetchPolicy } from '../CNSHomeostatStaleTimeRefetchPolicy';
import { CNSHomeostatRegulator } from '../CNSHomeostatRegulator';
import type { ICNSHomeostatCorrectionRepository } from '../interfaces/ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from '../interfaces/ICNSHomeostatFiringPolicy';
import type { TCNSHomeostatEnvironmentFactoryOptions } from '../types/TCNSHomeostatEnvironmentFactoryOptions';
import type { TCNSHomeostatEnvironmentOptions } from '../types/TCNSHomeostatEnvironmentOptions';
import { hashCNSHomeostatKey } from './hashCNSHomeostatKey';

export function createCNSHomeostatEnvironmentOptions<
    TFiringPolicy extends ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]>,
>(
    options: TCNSHomeostatEnvironmentFactoryOptions<TFiringPolicy, TCorrectionRepository>
        & Pick<TCNSHomeostatEnvironmentOptions<TFiringPolicy, TCorrectionRepository>,
            'homeostatFiringPolicy' | 'createHomeostatCorrectionRepository' | 'runUntracked' | 'runInTransaction' | 'scheduleRefetchAt'>
): TCNSHomeostatEnvironmentOptions<TFiringPolicy, TCorrectionRepository> {
    const stimulationOptions = options.stimulationOptions;
    return {
        cns: options.cns,
        homeostatFiringPolicy: options.homeostatFiringPolicy,
        createHomeostatCorrectionRepository: options.createHomeostatCorrectionRepository,
        createHomeostatRegulator: options.createHomeostatRegulator ?? (regulatorOptions => new CNSHomeostatRegulator(regulatorOptions)),
        createHomeostatRefetchPolicy: options.createHomeostatRefetchPolicy ?? (homeostatReceptor => new CNSHomeostatStaleTimeRefetchPolicy({
            staleTimeMs: homeostatReceptor.staleTimeMs ?? options.staleTimeMs ?? Infinity,
            homeostatRefractoryPolicy: homeostatReceptor.homeostatRefractoryPolicy ?? options.homeostatRefractoryPolicy,
        })),
        stimulationOptionsOf: options.stimulationOptionsOf ?? (homeostatReceptor => {
            const receptorStimulationOptions = homeostatReceptor.stimulationOptions;
            if (receptorStimulationOptions === undefined || stimulationOptions === undefined) return receptorStimulationOptions ?? stimulationOptions;
            return {
                ...stimulationOptions,
                ...receptorStimulationOptions,
                stimulationContext: { ...stimulationOptions.stimulationContext, ...receptorStimulationOptions.stimulationContext },
            };
        }),
        getNowMs: options.getNowMs ?? Date.now,
        keyHashFn: options.keyHashFn ?? hashCNSHomeostatKey,
        runUntracked: options.runUntracked,
        runInTransaction: options.runInTransaction,
        runWrite: options.runWrite ?? (write => write()),
        scheduleRefetchAt: options.scheduleRefetchAt,
    };
}
