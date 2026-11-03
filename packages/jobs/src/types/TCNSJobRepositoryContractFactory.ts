import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';

export type TCNSJobRepositoryContractFactory = {
    create(now: () => number): Promise<ICNSJobRepository>;
    destroy?(repository: ICNSJobRepository): Promise<void>;
};
