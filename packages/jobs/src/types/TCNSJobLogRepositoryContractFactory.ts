import type { ICNSJobLogRepository } from '../interfaces/ICNSJobLogRepository';

export type TCNSJobLogRepositoryContractFactory = {
    create(): Promise<ICNSJobLogRepository>;
    destroy?(logRepository: ICNSJobLogRepository): Promise<void>;
};
