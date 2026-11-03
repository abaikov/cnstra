import type { OIMDB } from '@oimdb/core';
import type { TCNSHomeostatEnvironmentOptions } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatCorrectionRepository } from '../interfaces/ICNSOIMDBHomeostatCorrectionRepository';
import type { ICNSOIMDBHomeostatFiringPolicy } from '../interfaces/ICNSOIMDBHomeostatFiringPolicy';

export type TCNSOIMDBHomeostatEnvironmentOptions = TCNSHomeostatEnvironmentOptions<ICNSOIMDBHomeostatFiringPolicy, ICNSOIMDBHomeostatCorrectionRepository> & {
    db: OIMDB;
};
