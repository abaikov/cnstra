import type { TCNSHomeostasisState } from './TCNSHomeostasisState';

export type TCNSHomeostatInvalidationWaiter<TKey> = {
    invalidationNumber: number;
    resolve: (homeostasisState: TCNSHomeostasisState<TKey> | undefined) => void;
    reject: (error: unknown) => void;
};
