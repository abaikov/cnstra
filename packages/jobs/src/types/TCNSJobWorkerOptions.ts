import type { CNSJobEventEmitter } from '../events/CNSJobEventEmitter';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import type { TCNSJobHandler } from './TCNSJobHandler';
import type { TCNSJobRunMiddleware } from './TCNSJobRunMiddleware';

export type TCNSJobWorkerOptions = {
    repository: ICNSJobRepository;
    handlers: readonly TCNSJobHandler[];
    middlewares?: readonly TCNSJobRunMiddleware[];
    events?: CNSJobEventEmitter;
    workerId?: string;
    leaseMs?: number;
    pollIntervalMs?: number;
    promoteIntervalMs?: number;
    maintenanceIntervalMs?: number;
    finishBatchMs?: number;
    stopTimeoutMs?: number;
    scheduleCatchUpMs?: number;
    historyHorizonMs?: number;
    now?: () => number;
    random?: () => number;
    onError?: (error: unknown) => void;
};
