import type { TCNSJobEnqueueResult } from '@cnstra/jobs';
import type { ICNSCollateral } from '@cnstra/types';
import type { TCNSJobsEnqueueOptions } from '../types/TCNSJobsEnqueueOptions';

export interface ICNSJobsEnqueuer<TTransaction> {
    enqueue<TPayload>(
        collateral: ICNSCollateral<TPayload>,
        payload: TPayload,
        options?: TCNSJobsEnqueueOptions<TTransaction>
    ): Promise<TCNSJobEnqueueResult | undefined>;
}
