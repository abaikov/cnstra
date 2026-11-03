import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ICNSJobStateRepository } from '../interfaces/ICNSJobStateRepository';
import type { TCNSJobStateRepositoryContractFactory } from '../types/TCNSJobStateRepositoryContractFactory';

export function describeCNSJobStateRepositoryContract(name: string, factory: TCNSJobStateRepositoryContractFactory): void {
    describe(`${name} — ICNSJobStateRepository contract`, () => {
        let stateRepository: ICNSJobStateRepository;
        let openAttempt: (jobId: string, asNewJob?: boolean) => Promise<{ seq: number; attemptNumber: number }>;

        const begin = async (jobId: string, asNewJob = false) => {
            const opened = await openAttempt(jobId, asNewJob);
            await stateRepository.begin(jobId, opened.seq, opened.attemptNumber);
            return opened;
        };

        const save = (jobId: string, opened: { seq: number; attemptNumber: number }, state: unknown) =>
            stateRepository.save(jobId, opened.seq, opened.attemptNumber, state);

        beforeEach(async () => {
            ({ stateRepository, openAttempt } = await factory.create());
        });

        afterEach(async () => {
            await factory.destroy?.(stateRepository);
        });

        it('loads nothing for a job that never saved', async () => {
            expect(await stateRepository.load('job-unknown')).toBeUndefined();
        });

        it('saves from the open attempt and loads it back', async () => {
            const opened = await begin('job-1');

            expect(await save('job-1', opened, { step: 1 })).toBe(true);
            expect(await save('job-1', opened, { step: 2 })).toBe(true);
            expect(await stateRepository.load('job-1')).toEqual({ step: 2 });
        });

        it('rejects a save from an older attempt once a newer one has begun', async () => {
            const zombie = await begin('job-1');
            await save('job-1', zombie, { from: 'first' });
            const current = await begin('job-1');

            expect(current.attemptNumber).toBeGreaterThan(zombie.attemptNumber);
            expect(await save('job-1', zombie, { from: 'zombie' })).toBe(false);
            expect(await stateRepository.load('job-1')).toEqual({ from: 'first' });
            expect(await save('job-1', current, { from: 'current' })).toBe(true);
            expect(await stateRepository.load('job-1')).toEqual({ from: 'current' });
        });

        it('starts a job that reuses an id without state and rejects saves of the earlier job', async () => {
            const earlier = await begin('job-1');
            await save('job-1', earlier, { from: 'earlier' });
            const current = await begin('job-1', true);

            expect(current.seq).toBeGreaterThan(earlier.seq);
            expect(current.attemptNumber).toBe(earlier.attemptNumber);
            expect(await stateRepository.load('job-1')).toBeUndefined();
            expect(await save('job-1', earlier, { from: 'zombie' })).toBe(false);
            expect(await save('job-1', current, { from: 'current' })).toBe(true);
            expect(await stateRepository.load('job-1')).toEqual({ from: 'current' });
        });

        it('keeps the state of different jobs apart', async () => {
            await save('job-1', await begin('job-1'), 'one');
            await save('job-2', await begin('job-2'), 'two');

            expect(await stateRepository.load('job-1')).toBe('one');
            expect(await stateRepository.load('job-2')).toBe('two');
        });

        it('stores a copy, so mutating the saved object does not change the stored state', async () => {
            const state = { items: [1] };
            await save('job-1', await begin('job-1'), state);
            state.items.push(2);

            expect(await stateRepository.load('job-1')).toEqual({ items: [1] });
        });
    });
}
