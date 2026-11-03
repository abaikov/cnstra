import { afterAll, beforeAll, jest } from '@jest/globals';
import { describeCNSJobLogRepositoryContract, describeCNSJobRepositoryContract } from '@cnstra/jobs/testing';
import postgres from 'postgres';
import { CNSPostgresJsJobDatabase } from '../database/CNSPostgresJsJobDatabase';
import { CNSPostgresJobLogRepository } from '../repository/CNSPostgresJobLogRepository';
import { CNSPostgresJobRepository } from '../repository/CNSPostgresJobRepository';
import { CNSPostgresTestDatabase } from './CNSPostgresTestDatabase';

jest.setTimeout(30_000);

const database = new CNSPostgresTestDatabase('cnstest_postgresjs_');

CNSPostgresTestDatabase.describe('CNSPostgresJobRepository on postgres.js', () => {
    const sql = postgres(CNSPostgresTestDatabase.url ?? '', { max: 6, onnotice: () => undefined });
    const postgresJs = new CNSPostgresJsJobDatabase(sql);

    beforeAll(() => database.migrate());
    afterAll(async () => {
        await sql.end();
        await database.end();
    });

    describeCNSJobRepositoryContract('repository', {
        create: async now => {
            await database.truncate();
            return new CNSPostgresJobRepository({ database: postgresJs, tablePrefix: database.tablePrefix, now });
        },
        destroy: repository => (repository as CNSPostgresJobRepository).close(),
    });

    describeCNSJobLogRepositoryContract('journal', {
        create: async () => {
            await database.truncate();
            return new CNSPostgresJobLogRepository(postgresJs, database.tablePrefix);
        },
    });
});
