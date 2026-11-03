export type TCNSJobRepositoryListener = {
    ready?(jobType: string): void;
    unchecked?(jobType: string): void;
    cancel?(jobId: string, seq: number, attemptNumber: number): void;
    done?(jobId: string): void;
};
