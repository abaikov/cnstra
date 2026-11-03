import type { CNSHomeostatRunningFiring } from '../CNSHomeostatRunningFiring';
import type { TCNSHomeostasisState } from './TCNSHomeostasisState';
import type { TCNSHomeostatSource } from './TCNSHomeostatSource';

export type TCNSHomeostasisQuery<TKey, TData> = {
    homeostasisState: TCNSHomeostasisState<TKey> | undefined;
    homeostatSource: TCNSHomeostatSource<TKey, TData> | undefined;
    homeostatSourceKey: TKey | undefined;
    homeostatSourceKeyHash: string | undefined;
    homeostatRunningFiring: CNSHomeostatRunningFiring<TKey> | undefined;
    heldKeyHash: string | undefined;
    isObserved: boolean;
};
