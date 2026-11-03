import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ICNSJobLogRepository } from '../interfaces/ICNSJobLogRepository';
import type { TCNSJobLogEntry } from '../types/TCNSJobLogEntry';
import type { TCNSJobLogRepositoryContractFactory } from '../types/TCNSJobLogRepositoryContractFactory';

const entry = (attemptNumber: number, seq: number, kind = 'log'): TCNSJobLogEntry => ({
    attemptNumber,
    seq,
    at: attemptNumber * 1000 + seq,
    kind,
    entry: { line: `${attemptNumber}.${seq}` },
});

export function describeCNSJobLogRepositoryContract(name: string, factory: TCNSJobLogRepositoryContractFactory): void {
    describe(`${name} — ICNSJobLogRepository contract`, () => {
        let logRepository: ICNSJobLogRepository;

        beforeEach(async () => {
            logRepository = await factory.create();
        });

        afterEach(async () => {
            await factory.destroy?.(logRepository);
        });

        it('lists entries ordered by attempt and seq, whatever order they were appended in', async () => {
            await logRepository.append('job-1', [entry(2, 1), entry(2, 2)]);
            await logRepository.append('job-1', [entry(1, 2), entry(1, 1)]);

            const listed = await logRepository.list('job-1');

            expect(listed.map(found => [found.attemptNumber, found.seq])).toEqual([
                [1, 1],
                [1, 2],
                [2, 1],
                [2, 2],
            ]);
            expect(listed[0]).toEqual(entry(1, 1));
        });

        it('keeps the entries of different jobs apart', async () => {
            await logRepository.append('job-1', [entry(1, 1)]);
            await logRepository.append('job-2', [entry(1, 1, 'task')]);

            expect((await logRepository.list('job-1')).map(found => found.kind)).toEqual(['log']);
            expect((await logRepository.list('job-2')).map(found => found.kind)).toEqual(['task']);
            expect(await logRepository.list('job-3')).toEqual([]);
        });

        it('filters by attempt number', async () => {
            await logRepository.append('job-1', [entry(1, 1), entry(2, 1), entry(2, 2)]);

            expect((await logRepository.list('job-1', { attemptNumber: 2 })).map(found => found.seq)).toEqual([1, 2]);
        });

        it('pages with an after cursor that crosses attempt boundaries', async () => {
            await logRepository.append('job-1', [entry(1, 1), entry(1, 2), entry(2, 1), entry(2, 2)]);

            const firstPage = await logRepository.list('job-1', { limit: 3 });
            const last = firstPage[firstPage.length - 1];
            const secondPage = await logRepository.list('job-1', {
                after: { attemptNumber: last.attemptNumber, seq: last.seq },
                limit: 3,
            });

            expect(firstPage.map(found => [found.attemptNumber, found.seq])).toEqual([
                [1, 1],
                [1, 2],
                [2, 1],
            ]);
            expect(secondPage.map(found => [found.attemptNumber, found.seq])).toEqual([[2, 2]]);
        });

        it('treats an empty append as a no-op', async () => {
            await logRepository.append('job-1', []);

            expect(await logRepository.list('job-1')).toEqual([]);
        });

        it('keeps one copy of an entry appended again at the same position', async () => {
            await logRepository.append('job-1', [entry(1, 1), entry(1, 2)]);
            await logRepository.append('job-1', [entry(1, 2), entry(1, 3)]);

            expect((await logRepository.list('job-1')).map(found => found.seq)).toEqual([1, 2, 3]);
        });

        it('stores entries as JSON', async () => {
            await logRepository.append('job-1', [{ ...entry(1, 1), entry: { when: new Date(0), cb: () => 1 } }]);

            expect((await logRepository.list('job-1'))[0].entry).toEqual({ when: '1970-01-01T00:00:00.000Z' });
        });

        it('deletes all entries of the given jobs only', async () => {
            await logRepository.append('job-1', [entry(1, 1)]);
            await logRepository.append('job-2', [entry(1, 1)]);

            await logRepository.delete(['job-1', 'job-unknown']);

            expect(await logRepository.list('job-1')).toEqual([]);
            expect(await logRepository.list('job-2')).toHaveLength(1);
        });

        it('returns copies the caller cannot use to change stored entries', async () => {
            await logRepository.append('job-1', [entry(1, 1)]);

            const [listed] = await logRepository.list('job-1');
            listed.kind = 'changed';

            expect((await logRepository.list('job-1'))[0].kind).toBe('log');
        });
    });
}
