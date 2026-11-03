/** How hard the runner works. Recorded into every report, because it changes the numbers. */
export type TCNSBenchRunnerOptions = {
    /**
     * Timed samples per case. Each is a whole batch; the reported figures are
     * percentiles over these. Default 40 — enough for a median and an IQR that
     * do not swing on one GC pause.
     */
    samples: number;

    /**
     * Untimed milliseconds per case before the first sample: JIT tiering,
     * inline-cache shaping and the first few GCs happen in here rather than in
     * the measurement. Default 400.
     */
    warmupMs: number;

    /**
     * Target duration of ONE sample, in milliseconds. The batch size is
     * calibrated until a sample lasts at least this long, which is what pushes
     * the clock's resolution and the loop's own overhead below the noise floor.
     * Default 2.
     */
    minSampleMs: number;

    /**
     * Upper bound on the calibrated batch size, so a case that measures almost
     * nothing cannot spin up a batch of tens of millions. Default 200_000.
     */
    maxBatchSize: number;

    /**
     * Upper bound on the operations the allocation probe runs in one window.
     * It is capped by the case's own batch size as well, and halved whenever a
     * garbage collection spoils the window. Default 4096 — large enough to
     * average out a one-off hidden-class transition, small enough that a cheap
     * case stays inside the young generation. See {@link CNSBenchAllocationProbe}.
     */
    allocationOperations: number;

    /**
     * Collect garbage between cases when `--expose-gc` made `globalThis.gc`
     * available. Keeps one case's garbage out of the next case's samples.
     * Ignored (and recorded as `false`) when the flag was not passed.
     */
    forceGc: boolean;
};
