import type { TCNSJobTypeDefinition } from '@cnstra/jobs';
import type { ICNSCollateral } from '@cnstra/types';
import type { TCNSJobsCompletionState } from './TCNSJobsCompletionState';
import type { TCNSJobsFailureState } from './TCNSJobsFailureState';

export type TCNSJobsTypeOptions<TPayload> = Omit<TCNSJobTypeDefinition<TPayload>, 'jobType'> & {
    maxNeuronHops?: number;
    onCompleted?: ICNSCollateral<TCNSJobsCompletionState<TPayload>>;
    onFailed?: ICNSCollateral<TCNSJobsFailureState<TPayload>>;
};
