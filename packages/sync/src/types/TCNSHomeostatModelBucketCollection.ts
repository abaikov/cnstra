import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

export type TCNSHomeostatModelBucketCollection = {
    readonly handle: unknown;
    writeBucket(key: TCNSHomeostatModelKey, ids: readonly (string | number)[]): boolean;
};
