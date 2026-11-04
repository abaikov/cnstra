import type { ECNSHomeostatCorrectionStatus } from '@cnstra/sync';

export type TCNSHomeostatEntityHomeostasis<TEntity extends object> = {
    readonly entity: TEntity | undefined;
    readonly status: ECNSHomeostatCorrectionStatus;
    readonly error: unknown;
};
