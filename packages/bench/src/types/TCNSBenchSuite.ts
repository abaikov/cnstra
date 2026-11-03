import type { TCNSBenchCase } from './TCNSBenchCase';

/** A named group of cases. The name is the prefix of every case id inside it. */
export type TCNSBenchSuite = {
    name: string;
    /** One line on what the suite is for; printed above its results. */
    summary: string;
    cases: TCNSBenchCase[];
};
