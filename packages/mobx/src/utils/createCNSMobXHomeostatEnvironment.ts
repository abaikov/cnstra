import { runInAction } from 'mobx';
import { CNSHomeostatFiringPolicy, cnsRunAll, createCNSHomeostatEnvironmentOptions, createCNSRunQueue } from '@cnstra/sync';
import type { ICNSHomeostatCorrectionRepository, ICNSHomeostatFiringPolicy, TCNSHomeostatEnvironmentFactoryOptions, TCNSHomeostatFiringPolicyOptions } from '@cnstra/sync';
import { CNSMobXHomeostatCorrectionRepository } from '../CNSMobXHomeostatCorrectionRepository';
import { CNSMobXHomeostatEnvironment } from '../CNSMobXHomeostatEnvironment';

export function createCNSMobXHomeostatEnvironment(
    options: TCNSHomeostatEnvironmentFactoryOptions & TCNSHomeostatFiringPolicyOptions
): CNSMobXHomeostatEnvironment {
    const scheduledRefetchByRefetchAtMs = new Map<number, { refetches: Set<() => void>; timeout: ReturnType<typeof setTimeout> }>();
    const homeostatEnvironmentOptions = createCNSHomeostatEnvironmentOptions<ICNSHomeostatFiringPolicy, ICNSHomeostatCorrectionRepository<readonly unknown[]>>({
        ...options,
        homeostatFiringPolicy: options.homeostatFiringPolicy ?? new CNSHomeostatFiringPolicy({ isOnline: options.isOnline, isVisible: options.isVisible }),
        createHomeostatCorrectionRepository: options.createHomeostatCorrectionRepository ?? (() => new CNSMobXHomeostatCorrectionRepository()),
        runUntracked: options.runUntracked ?? createCNSRunQueue(runQueued => queueMicrotask(() => runInAction(runQueued))),
        runInTransaction: options.runInTransaction ?? (run => runInAction(run)),
        runWrite: options.runWrite ?? (write => runInAction(write)),
        scheduleRefetchAt: options.scheduleRefetchAt ?? ((_homeostatCorrectionRepository, _keyHash, refetchAtMs, refetch) => {
            let scheduledRefetch = scheduledRefetchByRefetchAtMs.get(refetchAtMs);
            if (scheduledRefetch === undefined) {
                const refetches = new Set<() => void>();
                const timeout = setTimeout(() => {
                    scheduledRefetchByRefetchAtMs.delete(refetchAtMs);
                    runInAction(() => cnsRunAll(refetches));
                }, Math.min(Math.max(0, refetchAtMs - homeostatEnvironmentOptions.getNowMs()), 2 ** 31 - 1));
                (timeout as { unref?: () => void }).unref?.();
                scheduledRefetch = { refetches, timeout };
                scheduledRefetchByRefetchAtMs.set(refetchAtMs, scheduledRefetch);
            }
            const refetchScheduled = scheduledRefetch;
            refetchScheduled.refetches.add(refetch);
            return () => {
                refetchScheduled.refetches.delete(refetch);
                if (refetchScheduled.refetches.size > 0 || scheduledRefetchByRefetchAtMs.get(refetchAtMs) !== refetchScheduled) return;
                clearTimeout(refetchScheduled.timeout);
                scheduledRefetchByRefetchAtMs.delete(refetchAtMs);
            };
        }),
    });
    return new CNSMobXHomeostatEnvironment(homeostatEnvironmentOptions);
}
