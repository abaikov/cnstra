import { OIMChannelService, OIMSlotRefetchWheel } from '@oimdb/core';
import type { TOIMSlot } from '@oimdb/core';
import { cnsRunAll, createCNSHomeostatEnvironmentOptions } from '@cnstra/sync';
import { CNSOIMDBHomeostatCorrectionRepository } from '../CNSOIMDBHomeostatCorrectionRepository';
import { CNSOIMDBHomeostatEnvironment } from '../CNSOIMDBHomeostatEnvironment';
import { CNSOIMDBHomeostatFiringPolicy } from '../CNSOIMDBHomeostatFiringPolicy';
import type { ICNSOIMDBHomeostatCorrectionRepository } from '../interfaces/ICNSOIMDBHomeostatCorrectionRepository';
import type { ICNSOIMDBHomeostatFiringPolicy } from '../interfaces/ICNSOIMDBHomeostatFiringPolicy';
import type { TCNSOIMDBHomeostatEnvironmentFactoryOptions } from '../types/TCNSOIMDBHomeostatEnvironmentFactoryOptions';
import { createCNSOIMDBRunOutsideFlush } from './createCNSOIMDBRunOutsideFlush';
import { createCNSOIMDBHomeostatCorrectionStoreSlot } from './createCNSOIMDBHomeostatCorrectionStoreSlot';

export function createCNSOIMDBHomeostatEnvironment(options: TCNSOIMDBHomeostatEnvironmentFactoryOptions): CNSOIMDBHomeostatEnvironment {
    const db = options.db;
    const channelSlot = db.defaultChannelSlot;
    const runOutsideFlush = createCNSOIMDBRunOutsideFlush(channelSlot, options.cns);
    const refetchBySlot = new Map<TOIMSlot, () => void>();
    const slotRefetchWheel = new OIMSlotRefetchWheel(db, {
        slotRefetchListener: {
            onSlotsRefetchDue: slots => {
                const dueRefetches: (() => void)[] = [];
                for (const slot of slots) {
                    const refetch = refetchBySlot.get(slot);
                    if (refetch === undefined) continue;
                    refetchBySlot.delete(slot);
                    dueRefetches.push(refetch);
                }
                try {
                    options.cns.batch(() => cnsRunAll(dueRefetches));
                } finally {
                    if (refetchBySlot.size === 0) slotRefetchWheel.cancelAllSlots();
                }
            },
        },
    });
    return new CNSOIMDBHomeostatEnvironment({
        ...createCNSHomeostatEnvironmentOptions<ICNSOIMDBHomeostatFiringPolicy, ICNSOIMDBHomeostatCorrectionRepository>({
            ...options,
            homeostatFiringPolicy: options.homeostatFiringPolicy
                ?? new CNSOIMDBHomeostatFiringPolicy({ onlineSlot: options.onlineSlot, visibilitySlot: options.visibilitySlot }),
            createHomeostatCorrectionRepository: options.createHomeostatCorrectionRepository
                ?? (() => new CNSOIMDBHomeostatCorrectionRepository(createCNSOIMDBHomeostatCorrectionStoreSlot(db, options.homeostatCorrectionStoreSlotOptions))),
            getNowMs: options.getNowMs ?? db.collectorSlot.slotWheelOptions.getNowMs,
            runUntracked: options.runUntracked ?? runOutsideFlush,
            runInTransaction: options.runInTransaction ?? (run => run()),
            runWrite: options.runWrite ?? (write => {
                if (OIMChannelService.INSTANCE.isRefusingWrites(channelSlot)) runOutsideFlush(write);
                else write();
            }),
            scheduleRefetchAt: options.scheduleRefetchAt ?? ((homeostatCorrectionRepository, keyHash, refetchAtMs, refetch) => {
                const homeostatCorrectionSlot = homeostatCorrectionRepository.peekHomeostatCorrectionSlot(keyHash);
                if (homeostatCorrectionSlot === undefined) return;
                refetchBySlot.set(homeostatCorrectionSlot, refetch);
                slotRefetchWheel.scheduleSlotRefetchAt(homeostatCorrectionSlot, refetchAtMs);
                return () => {
                    if (refetchBySlot.get(homeostatCorrectionSlot) === refetch) refetchBySlot.delete(homeostatCorrectionSlot);
                    if (refetchBySlot.size === 0) slotRefetchWheel.cancelAllSlots();
                };
            }),
        }),
        db,
    });
}
