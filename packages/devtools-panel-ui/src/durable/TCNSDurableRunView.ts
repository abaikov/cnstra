/**
 * The admin view-model for one durable run: run status + resumable frontier +
 * the full attempt/task history the waterfall renders. Mirrors the server's
 * `snapshot()` shape (examples/src/admin/run-manager.ts `TRunSummary`); it is the
 * wire contract the polling client reads.
 */
export type TCNSDurableRunView = {
    runId: string;
    status: string;
    /** The CNS/graph this run belongs to (= cnsId); present on the WS stream. */
    scopeName?: string;
    entry: { collateralName: string; payload: unknown };
    /** Neuron names still outstanding — non-empty ⇒ retry can resume. */
    frontier: string[];
    attempts: Array<{
        attemptNumber: number;
        status: string;
        hopCount: number;
        startedAt?: number;
        completedAt?: number | null;
        tasks: Array<{
            index: number;
            neuronName: string;
            dendriteCollateralName?: string;
            status: string;
            output: { collateralName: string; payload: unknown } | null;
            error: string | null;
            startedAt?: number;
            duration?: number | null;
        }>;
    }>;
};
