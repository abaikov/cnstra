import type { TCNSHomeostatCNS } from '@cnstra/sync';

export type TCNSOIMDBHomeostatCNS = TCNSHomeostatCNS & {
    batch<TResult>(run: () => TResult): TResult;
};
