/**
 * Minimal, structural view of the BullMQ surface this package touches.
 *
 * We type against these instead of importing `bullmq` directly so the package
 * builds without bullmq/ioredis installed. Your real `Queue` / `Worker` / `Job`
 * satisfy these shapes structurally — pass them in.
 */
export interface IBullJob<TData = unknown> {
    /** BullMQ assigns this before the processor runs; stable across retries. */
    id?: string;
    name: string;
    data: TData;
    /** How many times this job has been attempted (0 on the first run). */
    attemptsMade?: number;
    /**
     * BullMQ's native per-job progress (number | object), persisted in Redis and
     * carried across retries of the same job. The resume checkpoint lives HERE by
     * default — no separate store — via `updateProgress` / reading `progress`.
     */
    progress?: unknown;
    updateProgress?(value: number | object): Promise<void>;
}

/** The function BullMQ calls per job. One job = one stimulation. */
export type TBullProcessor<TData> = (job: IBullJob<TData>) => Promise<unknown>;

/** Structural view of a constructed BullMQ `Worker`. */
export interface IBullWorkerLike {
    close(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * Structural view of the BullMQ `Worker` **class** — pass the class itself so
 * this package can construct the worker without importing bullmq.
 */
export interface IBullWorkerCtor {
    new <TData extends object>(
        name: string,
        processor: TBullProcessor<TData>,
        opts?: Record<string, unknown>
    ): IBullWorkerLike;
}

/** Structural view of a BullMQ `Queue` (producer side). */
export interface IBullQueueLike {
    add(
        name: string,
        data: object,
        opts?: Record<string, unknown>
    ): Promise<IBullJob>;
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

/** Structural view of the response passed to `onResponse` (not exported by core). */
export interface ICNSResponseLike {
    inputSignal?: { collateral?: unknown; payload?: unknown };
    outputSignal?: { collateral?: unknown; payload?: unknown };
    error?: unknown;
}
