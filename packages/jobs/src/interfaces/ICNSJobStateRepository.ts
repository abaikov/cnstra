export interface ICNSJobStateRepository {
    load(jobId: string): Promise<unknown>;
    begin(jobId: string, seq: number, attemptNumber: number): Promise<void>;
    save(jobId: string, seq: number, attemptNumber: number, state: unknown): Promise<boolean>;
}
