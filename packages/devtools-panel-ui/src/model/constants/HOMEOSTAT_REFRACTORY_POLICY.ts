import type { TCNSHomeostatRefractoryPolicy } from '@cnstra/sync';

export const HOMEOSTAT_REFRACTORY_POLICY: TCNSHomeostatRefractoryPolicy = { initialDelayMs: 500, multiplier: 2, maxDelayMs: 8_000, jitter: 0.2 };
