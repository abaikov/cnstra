import type { ICNSJobStateRepository } from '../interfaces/ICNSJobStateRepository';

export type TCNSJobStateRepositoryContractFactory = {
    create(): Promise<{
        stateRepository: ICNSJobStateRepository;
        openAttempt(jobId: string, asNewJob?: boolean): Promise<{ seq: number; attemptNumber: number }>;
    }>;
    destroy?(stateRepository: ICNSJobStateRepository): Promise<void>;
};
