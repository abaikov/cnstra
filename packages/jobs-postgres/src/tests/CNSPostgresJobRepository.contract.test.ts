import { afterAll, beforeAll, jest } from '@jest/globals';
import { describeCNSJobRepositoryContract } from '@cnstra/jobs/testing';
import { CNSPostgresJobRepository } from '../repository/CNSPostgresJobRepository';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

jest.setTimeout(30_000);

const database = new CNSPostgresTestDatabase('cnstest_contract_');

CNSPostgresTestDatabase.describe('CNSPostgresJobRepository', () => {
    beforeAll(() => database.migrate());
    afterAll(() => database.end());

    for (const history of [true, false]) {
        describeCNSJobRepositoryContract(history ? 'with history' : 'without history', {
            create: async now => {
                await database.truncate();
                return new CNSPostgresJobRepository({ database: database.database, tablePrefix: database.tablePrefix, now, history });
            },
            destroy: repository => (repository as CNSPostgresJobRepository).close(),
        });
    }
});
