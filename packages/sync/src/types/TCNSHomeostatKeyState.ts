import type { CNSHomeostatRunningFiring } from '../CNSHomeostatRunningFiring';
import type { TCNSHomeostatInvalidationWaiter } from './TCNSHomeostatInvalidationWaiter';

export type TCNSHomeostatKeyState<TKey> = {
    key: TKey;
    holderCount: number;
    homeostatRunningFiring: CNSHomeostatRunningFiring<TKey> | undefined;
    invalidationWaiters: TCNSHomeostatInvalidationWaiter<TKey>[] | undefined;
    refetchAtMs: number;
    cancelRefetch: (() => void) | void;
    refetch: () => void;
};
