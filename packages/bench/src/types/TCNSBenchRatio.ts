/**
 * The price of an option, as a multiple of the same flow without it.
 *
 * This is the metric that travels: a slower laptop makes both sides slower and
 * leaves the ratio where it was. A stored ratio is therefore comparable across
 * machines, which absolute nanoseconds are not.
 */
export type TCNSBenchRatio = {
    /** The case being priced. */
    id: string;
    /** The case it is priced against ({@link TCNSBenchCase.relativeTo}). */
    baseId: string;
    /** `median(id) / median(baseId)`. 1.0 means the option is free. */
    ratio: number;
    /**
     * The larger of the two cases' `rmadPercent`. A ratio built from two noisy
     * measurements is itself noisy, and the comparator needs to know by how much.
     */
    noisePercent: number;
};
