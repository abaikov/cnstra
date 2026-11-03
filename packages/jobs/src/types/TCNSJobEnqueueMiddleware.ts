import type { TCNSJobEnqueueRequest } from './TCNSJobEnqueueRequest';

export type TCNSJobEnqueueMiddleware = (request: TCNSJobEnqueueRequest, next: () => Promise<void>) => Promise<void>;
