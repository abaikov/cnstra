import { describe, expect, it } from '@jest/globals';
import { CNSInMemoryJobRepository } from '../repository/CNSInMemoryJobRepository';
import { describeCNSJobRepositoryContract } from '../testing';

describeCNSJobRepositoryContract('CNSInMemoryJobRepository', {
    create: async now => new CNSInMemoryJobRepository({ now }),
});

describeCNSJobRepositoryContract('CNSInMemoryJobRepository without history', {
    create: async now => new CNSInMemoryJobRepository({ now, history: false }),
});

describe('CNSInMemoryJobRepository.repairKeys', () => {
    it('advances a key whose owner vanished without advancing it', async () => {
        const repository = new CNSInMemoryJobRepository();
        await repository.enqueue([{ job: { jobType: 'mail', jobId: 'owner', jobKey: 'user-1', payload: null }, keyMode: 'serial' }]);
        await repository.enqueue([{ job: { jobType: 'mail', jobId: 'next', jobKey: 'user-1', payload: null }, keyMode: 'serial' }]);
        repository['live'].delete('owner');

        expect((await repository.claim([{ jobType: 'mail', free: 10, leaseMs: 1000 }], 'w')).claimed).toEqual([]);
        expect(await repository.repairKeys(['mail'])).toEqual(['next']);
        expect((await repository.claim([{ jobType: 'mail', free: 10, leaseMs: 1000 }], 'w')).claimed.map(jobState => jobState.jobId)).toEqual(['next']);
    });
});
