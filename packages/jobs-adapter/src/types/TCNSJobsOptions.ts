import type { ICNSJobRepository, TCNSJobEnqueueMiddleware } from '@cnstra/jobs';
import type { CNSPersistOptionsRegistry, ICNSProgressRecordingStrategy, ICNSStimulationWriter } from '@cnstra/persist';
import type { ICNS } from '@cnstra/types';
import type { TCNSJobsTypeOptions } from './TCNSJobsTypeOptions';

export type TCNSJobsOptions<TTransaction> = {
    cns: ICNS<any, any>;
    registry: CNSPersistOptionsRegistry;
    repository: ICNSJobRepository<TTransaction>;
    observe?: ICNSStimulationWriter;
    resumeStrategy?: ICNSProgressRecordingStrategy;
    middlewares?: readonly TCNSJobEnqueueMiddleware[];
    defaultTypeOptions?: Omit<TCNSJobsTypeOptions<unknown>, 'onCompleted' | 'onFailed' | 'schedules' | 'payloadSchema' | 'description'>;
    onError?: (error: unknown) => void;
};
