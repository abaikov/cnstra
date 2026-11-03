import type { TCNSJobWorkerOptions } from '@cnstra/jobs';

export type TCNSJobsWorkerOptions = Omit<TCNSJobWorkerOptions, 'repository' | 'handlers' | 'events' | 'onError'>;
