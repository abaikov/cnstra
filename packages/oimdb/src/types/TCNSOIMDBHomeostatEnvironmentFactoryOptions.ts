import type { OIMDB } from '@oimdb/core';
import type { TCNSHomeostatEnvironmentFactoryOptions } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatCorrectionRepository } from '../interfaces/ICNSOIMDBHomeostatCorrectionRepository';
import type { ICNSOIMDBHomeostatFiringPolicy } from '../interfaces/ICNSOIMDBHomeostatFiringPolicy';
import type { TCNSOIMDBHomeostatCorrectionStoreSlotOptions } from './TCNSOIMDBHomeostatCorrectionStoreSlotOptions';
import type { TCNSOIMDBHomeostatFiringPolicyOptions } from './TCNSOIMDBHomeostatFiringPolicyOptions';
import type { TCNSOIMDBHomeostatCNS } from './TCNSOIMDBHomeostatCNS';

export type TCNSOIMDBHomeostatEnvironmentFactoryOptions =
    TCNSHomeostatEnvironmentFactoryOptions<ICNSOIMDBHomeostatFiringPolicy, ICNSOIMDBHomeostatCorrectionRepository>
    & TCNSOIMDBHomeostatFiringPolicyOptions
    & {
        db: OIMDB;
        cns: TCNSOIMDBHomeostatCNS;
        homeostatCorrectionStoreSlotOptions?: TCNSOIMDBHomeostatCorrectionStoreSlotOptions;
    };
