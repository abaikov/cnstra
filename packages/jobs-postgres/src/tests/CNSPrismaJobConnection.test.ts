import { describe, expect, it } from '@jest/globals';
import { CNSPrismaJobConnection } from '../connection/CNSPrismaJobConnection';

describe('CNSPrismaJobConnection', () => {
    it('passes the positional parameters to $queryRawUnsafe and returns its rows', async () => {
        const calls: unknown[][] = [];
        const connection = CNSPrismaJobConnection.from({
            $queryRawUnsafe: async (...args: unknown[]) => {
                calls.push(args);
                return [{ job_id: 'a' }];
            },
        });

        const result = await connection.query('INSERT INTO t VALUES ($1::text, $2::int) RETURNING job_id', ['a', 2]);

        expect(calls).toEqual([['INSERT INTO t VALUES ($1::text, $2::int) RETURNING job_id', 'a', 2]]);
        expect(result).toEqual({ rows: [{ job_id: 'a' }], rowCount: 1 });
    });
});
