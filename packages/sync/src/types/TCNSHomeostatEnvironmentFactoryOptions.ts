import type { TCNSHomeostatCNS } from './TCNSHomeostatCNS';
import type { ICNSHomeostatCorrectionRepository } from '../interfaces/ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from '../interfaces/ICNSHomeostatFiringPolicy';
import type { TCNSHomeostatEnvironmentOptions } from './TCNSHomeostatEnvironmentOptions';
import type { TCNSHomeostatReceptorOptions } from './TCNSHomeostatReceptorOptions';

export type TCNSHomeostatEnvironmentFactoryOptions<
    TFiringPolicy extends ICNSHomeostatFiringPolicy = ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]> = ICNSHomeostatCorrectionRepository<readonly unknown[]>,
> = Partial<TCNSHomeostatEnvironmentOptions<TFiringPolicy, TCorrectionRepository>>
    & Pick<TCNSHomeostatReceptorOptions<unknown, unknown>, 'staleTimeMs' | 'homeostatRefractoryPolicy' | 'stimulationOptions'>
    & { cns: TCNSHomeostatCNS };
