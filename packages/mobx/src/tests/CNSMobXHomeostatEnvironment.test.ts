import { autorun, runInAction } from 'mobx';
import { CNS } from '@cnstra/core';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { cnsAt, cnsSettleMicrotasks, createCNSHomeostatTestDeckReceptor } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';
import { CNSMobXHomeostatCorrectionRepository, createCNSMobXHomeostatEnvironment } from '../index';

describe('the MobX default refetch scheduler', () => {
    it('waits a stale time longer than a timer can hold without spinning', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const { requested, deckReceptor, cns } = createCNSHomeostatTestDeckReceptor({ staleTimeMs: 40 * 24 * 60 * 60 * 1_000 });
            const homeostatEnvironment = createCNSMobXHomeostatEnvironment({ cns, getNowMs: () => Date.now() });
            const deckHomeostasis = homeostatEnvironment.createComputed(deckReceptor, ['d1']);
            const dispose = autorun(() => { deckHomeostasis.get(); });
            await cnsSettleMicrotasks();
            const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
            await jest.advanceTimersByTimeAsync(1_000);
            expect(setTimeoutSpy).not.toHaveBeenCalled();
            expect(requested).toEqual(['d1']);
            expect(jest.getTimerCount()).toBe(1);
            dispose();
            setTimeoutSpy.mockRestore();
        } finally {
            jest.useRealTimers();
        }
    });

    it('defers what a hundred queries ask for in one batch with one microtask', async () => {
        const { requested, deckReceptor, cns } = createCNSHomeostatTestDeckReceptor();
        const homeostatEnvironment = createCNSMobXHomeostatEnvironment({ cns });
        const queueMicrotaskSpy = jest.spyOn(globalThis, 'queueMicrotask');
        const disposers: (() => void)[] = [];
        runInAction(() => {
            for (let i = 0; i < 100; i++) {
                const deckHomeostasis = homeostatEnvironment.createComputed(deckReceptor, [`d${i}`]);
                disposers.push(autorun(() => { deckHomeostasis.get(); }));
            }
        });
        expect(queueMicrotaskSpy).toHaveBeenCalledTimes(1);
        queueMicrotaskSpy.mockRestore();
        await cnsSettleMicrotasks();
        expect(requested).toHaveLength(100);
        for (const dispose of disposers) dispose();
    });

    it('clears the refetch timers and aborts the running request on dispose', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const server = { requested: [] as string[], hang: false, abortSignals: [] as AbortSignal[] };
            const deckReceptor = new CNSHomeostatReceptor<[deckId: string], { id: string }>({
                name: 'deck',
                staleTimeMs: 5_000,
                transduce: ([deckId], abortSignal) => {
                    server.requested.push(deckId);
                    server.abortSignals.push(abortSignal);
                    if (!server.hang) return Promise.resolve({ id: deckId });
                    return new Promise((_resolve, reject) => { abortSignal.addEventListener('abort', () => reject(abortSignal.reason)); });
                },
            });
            const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron]);
            const homeostatEnvironment = createCNSMobXHomeostatEnvironment({ cns, getNowMs: () => Date.now() });
            const deckHomeostasis = homeostatEnvironment.createComputed(deckReceptor, ['d1']);
            const dispose = autorun(() => { deckHomeostasis.get(); });
            await cnsSettleMicrotasks();
            expect(server.requested).toEqual(['d1']);
            server.hang = true;
            const invalidated = homeostatEnvironment.invalidate(deckReceptor, ['d1']);
            await cnsSettleMicrotasks();
            expect(server.requested).toEqual(['d1', 'd1']);
            expect(jest.getTimerCount()).toBe(1);
            const writeHomeostatCorrectionState = jest.spyOn(homeostatEnvironment.homeostatCorrectionRepositoryOf(deckReceptor), 'writeHomeostatCorrectionState');
            homeostatEnvironment.dispose();
            expect(cnsAt(server.abortSignals, 1).aborted).toBe(true);
            expect(jest.getTimerCount()).toBe(0);
            await expect(invalidated).resolves.toBeUndefined();
            await jest.advanceTimersByTimeAsync(10_000);
            await cnsSettleMicrotasks();
            expect(server.requested).toEqual(['d1', 'd1']);
            expect(writeHomeostatCorrectionState).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBe(0);
            dispose();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('the MobX correction repository', () => {
    const write = (homeostatCorrectionRepository: CNSMobXHomeostatCorrectionRepository<[deckId: string]>) => homeostatCorrectionRepository.writeHomeostatCorrectionState('["d1"]', {
        receptorName: 'deck', key: ['d1'], status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1,
        attempt: 0, startedAtMs: 0, restoredAtMs: 0, failedAtMs: undefined, error: undefined, invalidationNumber: 0,
    });
    const day = 24 * 60 * 60 * 1_000;

    it('keeps a released record for a window longer than a timer can hold, and drops it at its end', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const homeostatCorrectionRepository = new CNSMobXHomeostatCorrectionRepository<[deckId: string]>({ keepAfterUnholdMs: 30 * day });
            homeostatCorrectionRepository.holdHomeostatCorrectionState('["d1"]');
            write(homeostatCorrectionRepository);
            homeostatCorrectionRepository.unholdHomeostatCorrectionState('["d1"]');
            await jest.advanceTimersByTimeAsync(29 * day);
            expect(homeostatCorrectionRepository.peekHomeostatCorrectionState('["d1"]')).toBeDefined();
            await jest.advanceTimersByTimeAsync(day);
            expect(homeostatCorrectionRepository.peekHomeostatCorrectionState('["d1"]')).toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it('keeps a released record forever with an infinite window', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const homeostatCorrectionRepository = new CNSMobXHomeostatCorrectionRepository<[deckId: string]>({ keepAfterUnholdMs: Infinity });
            homeostatCorrectionRepository.holdHomeostatCorrectionState('["d1"]');
            write(homeostatCorrectionRepository);
            homeostatCorrectionRepository.unholdHomeostatCorrectionState('["d1"]');
            await jest.advanceTimersByTimeAsync(400 * day);
            expect(homeostatCorrectionRepository.peekHomeostatCorrectionState('["d1"]')).toBeDefined();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});
