import type { CNSJobEventEmitter } from '../events/CNSJobEventEmitter';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import type { TCNSJobEnqueueMiddleware } from './TCNSJobEnqueueMiddleware';
import type { TCNSJobTypeDefinition } from './TCNSJobTypeDefinition';

export type TCNSJobQueueOptions<TTransaction = unknown> = {
    repository: ICNSJobRepository<TTransaction>;
    definitions?: readonly TCNSJobTypeDefinition[];
    middlewares?: readonly TCNSJobEnqueueMiddleware[];
    events?: CNSJobEventEmitter;
};
