/**
 * Minimal, structural view of the pg-boss surface this package touches.
 *
 * We type against these instead of importing `pg-boss` directly so the package
 * builds without pg-boss installed. It is compatible with pg-boss v9/v10+ where
 * `work` handlers receive an array of jobs (batch). Pass your real `PgBoss`
 * instance — it satisfies this shape structurally.
 */
export interface IPgBossJob<TData = unknown> {
    id: string;
    name: string;
    data: TData;
}

export interface IPgBossLike {
    send(
        name: string,
        data: object,
        options?: Record<string, unknown>
    ): Promise<string | null>;
    work<TData extends object>(
        name: string,
        handler: (jobs: IPgBossJob<TData>[]) => Promise<unknown>
    ): Promise<string>;
    work<TData extends object>(
        name: string,
        options: Record<string, unknown>,
        handler: (jobs: IPgBossJob<TData>[]) => Promise<unknown>
    ): Promise<string>;
}

/**
 * The payload placed on the queue. It carries the collateral **name** and a
 * JSON-serializable payload — never live neuron/collateral object references,
 * which are not portable across processes.
 */
export interface TCNSStimulationJobData {
    collateralName: string;
    payload: unknown;
    /** Optional per-run cap on neuron hops. */
    maxNeuronHops?: number;
}

/** One per-hop progress record (mirrors the devtools `CNSDTOHop` shape). */
export interface TCNSHopRecord {
    jobId: string;
    index: number;
    neuronName: string | null;
    inputCollateral: string | null;
    outputCollateral: string | null;
    inputPayload: unknown;
    outputPayload: unknown;
    error: string | null;
    at: number;
}

/** Lifecycle record for one stimulation (one job). */
export interface TCNSStimulationLifecycle {
    jobId: string;
    collateralName: string;
    payload: unknown;
    status: 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt?: number;
    hopCount: number;
    error?: string;
}

/**
 * Where progress is written (Postgres, OIMDB, logs, …).
 *
 * If `onHop` returns a Promise, CNStra waits for it **before enqueuing the next
 * hop** — i.e. each step is durably committed before the flow advances. This is
 * the per-hop checkpoint barrier that makes an admin/progress view truthful
 * across restarts.
 */
export interface ICNSProgressSink {
    onStarted?(rec: TCNSStimulationLifecycle): void | Promise<void>;
    onHop?(rec: TCNSHopRecord): void | Promise<void>;
    onCompleted?(rec: TCNSStimulationLifecycle): void | Promise<void>;
}

/** Structural view of the response passed to `onResponse` (not exported by core). */
export interface ICNSResponseLike {
    inputSignal?: { collateral?: unknown; payload?: unknown };
    outputSignal?: { collateral?: unknown; payload?: unknown };
    error?: unknown;
}
