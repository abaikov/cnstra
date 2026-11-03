import { CNSInMemoryJobRepository } from '../repository/CNSInMemoryJobRepository';
import { CNSJobContractAttempts, describeCNSJobStateRepositoryContract } from '../testing';

describeCNSJobStateRepositoryContract('CNSInMemoryJobRepository.stateRepository', {
    create: async () => {
        const repository = new CNSInMemoryJobRepository();
        return {
            stateRepository: repository.stateRepository,
            openAttempt: (jobId, asNewJob) => CNSJobContractAttempts.open(repository, jobId, asNewJob),
        };
    },
});
