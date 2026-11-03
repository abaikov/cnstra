import { CNSInMemoryJobLogRepository } from '../repository/CNSInMemoryJobLogRepository';
import { describeCNSJobLogRepositoryContract } from '../testing';

describeCNSJobLogRepositoryContract('CNSInMemoryJobLogRepository', {
    create: async () => new CNSInMemoryJobLogRepository(),
});
