import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

export type TCNSHomeostatModelSummaryCollection<TSummary extends object> = {
    readonly handle: unknown;
    writeSummary(key: TCNSHomeostatModelKey, summary: TSummary): boolean;
};
