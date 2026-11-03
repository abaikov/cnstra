import type { TCNSHomeostatOutcomeStatus } from './TCNSHomeostatOutcomeStatus';

export type TCNSHomeostatOutcome<TKey> = {
    receptorName: string;
    key: TKey;
    firingNumber: number;
    status: TCNSHomeostatOutcomeStatus;
    error: unknown;
    startedAtMs: number;
    nowMs: number;
    invalidationNumber: number;
};
