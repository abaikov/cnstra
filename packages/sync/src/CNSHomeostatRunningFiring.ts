import type { ICNSStimulation } from '@cnstra/types';
import type { ICNSHomeostatRunningFiring } from './interfaces/ICNSHomeostatRunningFiring';
import type { TCNSHomeostasisState } from './types/TCNSHomeostasisState';
import { createCNSHomeostasisState } from './utils/createCNSHomeostasisState';
import type { TCNSHomeostatOutcomeStatus } from './types/TCNSHomeostatOutcomeStatus';

export class CNSHomeostatRunningFiring<TKey> implements ICNSHomeostatRunningFiring<TKey> {
    public readonly key: TKey;

    public readonly keyHash: string;

    public readonly firingNumber: number;

    public readonly abortController = new AbortController();

    public holderCount = 1;

    public invalidationNumber = 0;

    public pendingStart: (() => void) | undefined = undefined;

    public outcomeStatus: TCNSHomeostatOutcomeStatus | undefined = undefined;

    private outcomeError: unknown = undefined;

    private outcomeStimulation: Pick<ICNSStimulation<never>, 'waitUntilComplete'> | undefined = undefined;

    private settledPromise: Promise<TCNSHomeostasisState<TKey>> | undefined = undefined;

    private resolveSettled: ((homeostasisState: TCNSHomeostasisState<TKey>) => void) | undefined = undefined;

    private rejectSettled: ((error: unknown) => void) | undefined = undefined;

    public constructor(key: TKey, keyHash: string, firingNumber: number) {
        this.key = key;
        this.keyHash = keyHash;
        this.firingNumber = firingNumber;
    }

    public waitUntilSettled(): Promise<TCNSHomeostasisState<TKey>> {
        if (this.settledPromise !== undefined) return this.settledPromise;
        const abortSignal = this.abortController.signal;
        if (abortSignal.aborted) this.settledPromise = Promise.reject(abortSignal.reason);
        else if (this.outcomeStimulation !== undefined && this.outcomeStatus !== undefined) this.settledPromise = this.settleAfter(this.outcomeStimulation, this.outcomeStatus);
        else this.settledPromise = new Promise((resolve, reject) => {
            this.resolveSettled = resolve;
            this.rejectSettled = reject;
        });
        return this.settledPromise;
    }

    public answer(outcomeStatus: TCNSHomeostatOutcomeStatus, outcomeError: unknown): void {
        this.outcomeStatus = outcomeStatus;
        this.outcomeError = outcomeError;
    }

    public complete(outcomeStimulation: Pick<ICNSStimulation<never>, 'waitUntilComplete'>): void {
        this.outcomeStimulation = outcomeStimulation;
        const outcomeStatus = this.outcomeStatus;
        if (outcomeStatus === undefined) return;
        const resolveSettled = this.resolveSettled;
        const rejectSettled = this.rejectSettled;
        if (resolveSettled === undefined || rejectSettled === undefined) return;
        this.resolveSettled = undefined;
        this.rejectSettled = undefined;
        this.settleAfter(outcomeStimulation, outcomeStatus).then(resolveSettled, rejectSettled);
    }

    public abort(abortCause: 'superseded' | 'released' | 'disposed'): void {
        const abortSignal = this.abortController.signal;
        this.abortController.abort(new DOMException(`homeostat request ${abortCause}`, 'AbortError'));
        const rejectSettled = this.rejectSettled;
        if (rejectSettled === undefined) return;
        this.resolveSettled = undefined;
        this.rejectSettled = undefined;
        rejectSettled(abortSignal.reason);
    }

    private async settleAfter(
        outcomeStimulation: Pick<ICNSStimulation<never>, 'waitUntilComplete'>,
        outcomeStatus: TCNSHomeostatOutcomeStatus
    ): Promise<TCNSHomeostasisState<TKey>> {
        await outcomeStimulation.waitUntilComplete();
        return createCNSHomeostasisState(this.key, outcomeStatus, this.firingNumber, this.outcomeError, undefined);
    }
}
