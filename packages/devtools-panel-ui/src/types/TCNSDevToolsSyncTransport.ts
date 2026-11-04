import type { TCNSHomeostatBatchTransducerOptions } from '@cnstra/sync';

export type TCNSDevToolsSyncTransport = {
    batchTransduceFn: TCNSHomeostatBatchTransducerOptions['batchTransduceFn'];
    failPendingRequests(error: unknown): void;
};
