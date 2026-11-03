import type { TOIMEntityContentSlot } from '@oimdb/core';
import { CNSHomeostatFiringPolicy } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatFiringPolicy } from './interfaces/ICNSOIMDBHomeostatFiringPolicy';
import type { TCNSOIMDBHomeostatFiringPolicyOptions } from './types/TCNSOIMDBHomeostatFiringPolicyOptions';

export class CNSOIMDBHomeostatFiringPolicy extends CNSHomeostatFiringPolicy implements ICNSOIMDBHomeostatFiringPolicy {
    public readonly sourceSlots: readonly TOIMEntityContentSlot[];

    public constructor(options: TCNSOIMDBHomeostatFiringPolicyOptions) {
        const onlineSlot = options.onlineSlot;
        const visibilitySlot = options.visibilitySlot;
        super({
            isOnline: onlineSlot === undefined ? undefined : () => onlineSlot.entity?.isOnline ?? true,
            isVisible: visibilitySlot === undefined ? undefined : () => visibilitySlot.entity?.isVisible ?? true,
        });
        const sourceSlots: TOIMEntityContentSlot[] = [];
        if (onlineSlot !== undefined) sourceSlots.push(onlineSlot);
        if (visibilitySlot !== undefined) sourceSlots.push(visibilitySlot);
        this.sourceSlots = sourceSlots;
    }
}
