import type { TCNSHomeostasisState } from '../types/TCNSHomeostasisState';

export interface ICNSHomeostatRunningFiring<TKey> {
    readonly firingNumber: number;
    waitUntilSettled(): Promise<TCNSHomeostasisState<TKey>>;
}
