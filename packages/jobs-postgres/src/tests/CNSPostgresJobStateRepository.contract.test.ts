import { afterAll, beforeAll, jest } from '@jest/globals';
import { CNSJobContractAttempts, describeCNSJobStateRepositoryContract } from '@cnstra/jobs/testing';
import { CNSPostgresJobRepository } from '../repository/CNSPostgresJobRepository';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

jest.setTimeout(30_000);

const database = new CNSPostgresTestDatabase('cnstest_state_');

CNSPostgresTestDatabase.describe('CNSPostgresJobRepository.stateRepository', () => {
    beforeAll(() => database.migrate());
    afterAll(() => database.end());

    describeCNSJobStateRepositoryContract('Postgres', {
        create: async () => {
            await database.truncate();
            const repository = new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix });
            return {
                stateRepository: repository.stateRepository,
                openAttempt: (jobId, asNewJob) => CNSJobContractAttempts.open(repository, jobId, asNewJob),
            };
        },
    });
});
