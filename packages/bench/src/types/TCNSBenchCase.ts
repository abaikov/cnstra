import type { TCNSBenchBody } from './TCNSBenchBody';

/**
 * One benchmark: a stable id, a sentence saying what a single operation is, and
 * a `prepare` that builds the fixtures and hands back the body to time.
 */
export type TCNSBenchCase = {
    /**
     * Stable identifier, `suite/case` — for example `engine/linear-chain-8`.
     * It is the key a baseline is matched on, so renaming a case discards its
     * history. Rename deliberately.
     */
    id: string;

    /**
     * What ONE operation is, in words: "one `stimulate()` of an 8-neuron
     * synchronous chain (8 dendrite bodies)". Printed next to the number,
     * because `ops/sec` without this is not a measurement of anything.
     */
    operation: string;

    /**
     * Id of the case this one is read against. When set, the report carries a
     * ratio (`this.median / that.median`) as well as the absolute number.
     *
     * Ratios survive a change of machine; absolute nanoseconds do not. Every
     * case that exists to price an OPTION (a listener, a persistor, tracing)
     * sets this, pointing at the same flow with the option off.
     */
    relativeTo?: string;

    /**
     * Marks the case as one point on a size curve. Cases sharing a `family` are
     * fitted to `time ~ n^k` and the report carries `k` — which, unlike a
     * duration, means the same thing on every machine. This is how a linear
     * derivation turning quadratic becomes visible.
     */
    scaling?: {
        family: string;
        /** The size parameter: hops, frontier tasks, stored runs. */
        n: number;
    };

    /** Per-case override of the runner's sample count (for slow cases). */
    samples?: number;
    /** Per-case override of the runner's warmup budget, in milliseconds. */
    warmupMs?: number;

    /** Build the fixtures (untimed) and return the body to measure. */
    prepare: () => TCNSBenchBody | Promise<TCNSBenchBody>;
};
