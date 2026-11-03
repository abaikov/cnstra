import type { TCNSHomeostatTransductionRequest } from './TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from './TCNSHomeostatTransductionRow';

export type TCNSHomeostatBatchTransducerOptions = {
    batchTransduceFn: (
        homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[],
        abortSignal: AbortSignal
    ) => Promise<readonly TCNSHomeostatTransductionRow[]>;
    batchScheduleFn?: ((sendBatch: () => void) => void) | undefined;
};
