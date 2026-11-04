import type { CNSHomeostatEnvironment } from '../CNSHomeostatEnvironment';
import type { ICNSHomeostatCorrectionRepository } from './ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from './ICNSHomeostatFiringPolicy';
import type { TCNSHomeostatEnvironmentOptions } from '../types/TCNSHomeostatEnvironmentOptions';
import type { TCNSHomeostatModelKey } from '../types/TCNSHomeostatModelKey';

export interface ICNSHomeostatModelHandles {
    readonly entity: object;
    readonly key: TCNSHomeostatModelKey;
    readonly summary: object;
    readonly homeostatEnvironment: Pick<CNSHomeostatEnvironment, 'invalidate' | 'invalidateAll' | 'invalidateByKeyPrefix' | 'dispose'> & {
        readonly homeostatEnvironmentOptions: Pick<
            TCNSHomeostatEnvironmentOptions<ICNSHomeostatFiringPolicy, ICNSHomeostatCorrectionRepository<readonly unknown[]>>,
            'runInTransaction'
        >;
    };
    readonly receptiveDemand: unknown;
    readonly entityCollection: unknown;
    readonly bucketCollection: unknown;
    readonly summaryCollection: unknown;
    readonly homeostasis: unknown;
}
