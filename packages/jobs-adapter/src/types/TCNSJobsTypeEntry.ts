import type { TCNSJobTypeDefinition } from '@cnstra/jobs';
import type { TCNSJobsTypeOptions } from './TCNSJobsTypeOptions';

export type TCNSJobsTypeEntry = {
    definition: TCNSJobTypeDefinition;
    options: TCNSJobsTypeOptions<unknown>;
};
