import { OIMChannelService } from '@oimdb/core';
import type { TOIMChannelSlot } from '@oimdb/core';
import { createCNSRunQueue } from '@cnstra/sync';
import type { TCNSOIMDBHomeostatCNS } from '../types/TCNSOIMDBHomeostatCNS';

export function createCNSOIMDBRunOutsideFlush(channelSlot: TOIMChannelSlot, cns: Pick<TCNSOIMDBHomeostatCNS, 'batch'>): (run: () => void) => void {
    return createCNSRunQueue(runQueuedOutsideBatch => {
        const runQueued = () => cns.batch(runQueuedOutsideBatch);
        if (!OIMChannelService.INSTANCE.isRefusingWrites(channelSlot)) {
            queueMicrotask(runQueued);
            return;
        }
        const unsubscribe = OIMChannelService.INSTANCE.subscribeAfterEachFlush(channelSlot, () => {
            unsubscribe();
            runQueued();
        });
    });
}
