import type { ECNSHomeostatCorrectionStatus } from './ECNSHomeostatCorrectionStatus';

export type TCNSHomeostatCorrectionState<TKey> = {
    receptorName: string;
    key: TKey;
    status: ECNSHomeostatCorrectionStatus;
    firingNumber: number;
    attempt: number;
    startedAtMs: number;
    restoredAtMs: number | undefined;
    failedAtMs: number | undefined;
    error: unknown;
    invalidationNumber: number;
};
