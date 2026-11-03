export type TCNSJobLogEntry = {
    attemptNumber: number;
    seq: number;
    at: number;
    kind: string;
    entry?: unknown;
};
