import { CNSHomeostatStaleTimeRefetchPolicy, computeCNSHomeostatRefractoryDelayMs, ECNSHomeostatCorrectionStatus } from '../index';
import type { TCNSHomeostatCorrectionState } from '../index';

const homeostatRefractoryPolicy = { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 5_000 };

const failedHomeostatCorrectionStateOf = (firingNumber: number): TCNSHomeostatCorrectionState<unknown> => ({
    receptorName: 'deck',
    key: ['d1'],
    status: ECNSHomeostatCorrectionStatus.Failed,
    firingNumber,
    attempt: 1,
    startedAtMs: 0,
    restoredAtMs: undefined,
    failedAtMs: 10_000,
    error: new Error('HTTP 503'),
    invalidationNumber: 0,
});

describe('how long a refractory key waits', () => {
    it('waits the initial delay after the first failure and grows by the multiplier', () => {
        expect(computeCNSHomeostatRefractoryDelayMs(homeostatRefractoryPolicy, 1, 0.5)).toBe(1_000);
        expect(computeCNSHomeostatRefractoryDelayMs(homeostatRefractoryPolicy, 2, 0.5)).toBe(2_000);
        expect(computeCNSHomeostatRefractoryDelayMs(homeostatRefractoryPolicy, 3, 0.5)).toBe(4_000);
    });

    it('never waits longer than the cap', () => {
        expect(computeCNSHomeostatRefractoryDelayMs(homeostatRefractoryPolicy, 10, 0.5)).toBe(5_000);
    });

    it('takes up to the jitter share of the delay off, by the jitter fraction', () => {
        const jitteredRefractoryPolicy = { ...homeostatRefractoryPolicy, jitter: 0.5 };

        expect(computeCNSHomeostatRefractoryDelayMs(jitteredRefractoryPolicy, 2, 0)).toBe(2_000);
        expect(computeCNSHomeostatRefractoryDelayMs(jitteredRefractoryPolicy, 2, 0.5)).toBe(1_500);
        expect(computeCNSHomeostatRefractoryDelayMs(jitteredRefractoryPolicy, 10, 1)).toBe(2_500);
    });

    it('gives the same failure the same jittered refetch time and different failures different ones', () => {
        const homeostatRefetchPolicy = new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: 1_000, homeostatRefractoryPolicy: { ...homeostatRefractoryPolicy, jitter: 1 } });
        const refetchAtMsList = [1, 2, 3, 4, 5].map(firingNumber => homeostatRefetchPolicy.refetchAtMs(failedHomeostatCorrectionStateOf(firingNumber)));

        expect(homeostatRefetchPolicy.refetchAtMs(failedHomeostatCorrectionStateOf(1))).toBe(refetchAtMsList[0]);
        expect(new Set(refetchAtMsList).size).toBe(5);
        for (const refetchAtMs of refetchAtMsList) {
            expect(refetchAtMs).toBeGreaterThan(10_000);
            expect(refetchAtMs).toBeLessThanOrEqual(11_000);
        }
    });

    it('refuses a jitter outside 0 to 1', () => {
        expect(() => new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: 1_000, homeostatRefractoryPolicy: { ...homeostatRefractoryPolicy, jitter: 1.5 } }))
            .toThrow('jitter 1.5 is not a share of the delay');
    });
});
