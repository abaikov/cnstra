/**
 * The measurable part of a benchmark case, handed back by
 * {@link TCNSBenchCase.prepare} once the fixtures are standing.
 *
 * Only `run` is timed. Everything a case needs — graphs, registries, seeded
 * repositories — is built in `prepare` and closed over here, so no fixture
 * construction leaks into the measurement.
 */
export type TCNSBenchBody = {
    /**
     * One operation. Called many times in a tight loop; must be free of
     * `Math.random`, of wall-clock branching, and of anything that makes the
     * n-th call cheaper or dearer than the first.
     *
     * Returns a promise only for genuinely asynchronous work — a synchronous
     * body returns `undefined`, so the runner's loop takes no microtask for it.
     */
    run: () => void | Promise<void>;

    /**
     * Run once, before warmup, to prove the body does the work it claims.
     * Throw to fail the case. Without this, a benchmark that quietly stopped
     * doing anything reads as a spectacular speed-up.
     */
    verify?: () => void | Promise<void>;

    /** Release listeners, timers and handles after the last sample. */
    teardown?: () => void | Promise<void>;
};
