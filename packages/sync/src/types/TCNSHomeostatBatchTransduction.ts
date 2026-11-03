import type { TCNSHomeostatTransductionRequest } from './TCNSHomeostatTransductionRequest';

export type TCNSHomeostatBatchTransduction = {
    readonly homeostatTransductionRequest: TCNSHomeostatTransductionRequest;
    readonly waiters: {
        readonly abortSignal: AbortSignal;
        readonly answer: (values: readonly unknown[]) => void;
        readonly reject: (error: unknown) => void;
    }[];
};
