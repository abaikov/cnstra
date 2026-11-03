import { afterAll, beforeAll, jest } from '@jest/globals';
import { describeCNSJobLogRepositoryContract } from '@cnstra/jobs/testing';
import { CNSPostgresJobLogRepository } from '../repository/CNSPostgresJobLogRepository';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

jest.setTimeout(30_000);

const database = new CNSPostgresTestDatabase('cnstest_log_');

CNSPostgresTestDatabase.describe('CNSPostgresJobLogRepository', () => {
    beforeAll(() => database.migrate());
    afterAll(() => database.end());

    describeCNSJobLogRepositoryContract('Postgres', {
        create: async () => {
            await database.truncate();
            return new CNSPostgresJobLogRepository(database.database, database.tablePrefix);
        },
    });
});
