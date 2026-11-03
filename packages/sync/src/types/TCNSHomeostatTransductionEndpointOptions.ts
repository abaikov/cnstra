import type { ICNSHomeostatTransductionCodec } from '../interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionRequest } from './TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from './TCNSHomeostatTransductionRow';

export type TCNSHomeostatTransductionEndpointOptions = {
    batchTransduceFn: (homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]) => Promise<readonly TCNSHomeostatTransductionRow[]>;
    homeostatTransductionCodecs?: readonly ICNSHomeostatTransductionCodec[] | undefined;
    maxBatchSize?: number | undefined;
};
