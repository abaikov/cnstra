import { runInAction } from 'mobx';
import { CNSHomeostatFiringPolicy, computeCNSHomeostatRefetchSliceEndMs, runAll, createCNSHomeostatEnvironmentOptions, createCNSRunQueue } from '@cnstra/sync';
import type { ICNSHomeostatCorrectionRepository, ICNSHomeostatFiringPolicy, TCNSHomeostatEnvironmentFactoryOptions, TCNSHomeostatFiringPolicyOptions } from '@cnstra/sync';
import { CNSMobXHomeostatCorrectionRepository } from '../CNSMobXHomeostatCorrectionRepository';
import { CNSMobXHomeostatEnvironment } from '../CNSMobXHomeostatEnvironment';
import { CNS_MOBX_HOMEOSTAT_MAX_TIMEOUT_MS } from './CNS_MOBX_HOMEOSTAT_MAX_TIMEOUT_MS';

export function createCNSMobXHomeostatEnvironment(
    options: TCNSHomeostatEnvironmentFactoryOptions & TCNSHomeostatFiringPolicyOptions
): CNSMobXHomeostatEnvironment {
    const scheduledRefetchBySliceEndMs = new Map<number, { refetches: Set<() => void>; timeout: ReturnType<typeof setTimeout> }>();
    const homeostatEnvironmentOptions = createCNSHomeostatEnvironmentOptions<ICNSHomeostatFiringPolicy, ICNSHomeostatCorrectionRepository<readonly unknown[]>>({
        ...options,
        homeostatFiringPolicy: options.homeostatFiringPolicy ?? new CNSHomeostatFiringPolicy({ isOnline: options.isOnline, isVisible: options.isVisible }),
        createHomeostatCorrectionRepository: options.createHomeostatCorrectionRepository ?? (() => new CNSMobXHomeostatCorrectionRepository()),
        runUntracked: options.runUntracked ?? createCNSRunQueue(runQueued => queueMicrotask(() => runInAction(runQueued))),
        runInTransaction: options.runInTransaction ?? (run => runInAction(run)),
        runWrite: options.runWrite ?? (write => runInAction(write)),
        scheduleRefetchAt: options.scheduleRefetchAt ?? ((_homeostatCorrectionRepository, _keyHash, refetchAtMs, refetch) => {
            const sliceEndMs = computeCNSHomeostatRefetchSliceEndMs(refetchAtMs);
            let scheduledRefetch = scheduledRefetchBySliceEndMs.get(sliceEndMs);
            if (scheduledRefetch === undefined) {
                const refetches = new Set<() => void>();
                const timeout = setTimeout(() => {
                    scheduledRefetchBySliceEndMs.delete(sliceEndMs);
                    runInAction(() => runAll(refetches));
                }, Math.min(Math.max(0, sliceEndMs - homeostatEnvironmentOptions.getNowMs()), CNS_MOBX_HOMEOSTAT_MAX_TIMEOUT_MS));
                (timeout as { unref?: () => void }).unref?.();
                scheduledRefetch = { refetches, timeout };
                scheduledRefetchBySliceEndMs.set(sliceEndMs, scheduledRefetch);
            }
            const refetchScheduled = scheduledRefetch;
            refetchScheduled.refetches.add(refetch);
            return () => {
                refetchScheduled.refetches.delete(refetch);
                if (refetchScheduled.refetches.size > 0 || scheduledRefetchBySliceEndMs.get(sliceEndMs) !== refetchScheduled) return;
                clearTimeout(refetchScheduled.timeout);
                scheduledRefetchBySliceEndMs.delete(sliceEndMs);
            };
        }),
    });
    return new CNSMobXHomeostatEnvironment(homeostatEnvironmentOptions);
}
