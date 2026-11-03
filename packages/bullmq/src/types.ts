/**
 * Minimal, structural view of the BullMQ surface this package touches.
 *
 * We type against these instead of importing `bullmq` directly so the package
 * builds without bullmq/ioredis installed. Your real `Queue` / `Worker` / `Job`
 * satisfy these shapes structurally — pass them in.
 */
export interface ICNSBullJob<TData = unknown> {
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
export type TCNSBullProcessor<TData> = (job: ICNSBullJob<TData>) => Promise<unknown>;

/** Structural view of a constructed BullMQ `Worker`. */
export interface ICNSBullWorkerLike {
    close(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * Structural view of the BullMQ `Worker` **class** — pass the class itself so
 * this package can construct the worker without importing bullmq.
 */
export interface ICNSBullWorkerCtor<TWorkerOptions> {
    new <TData extends object>(
        name: string,
        processor: TCNSBullProcessor<TData>,
        opts: TWorkerOptions
    ): ICNSBullWorkerLike;
}

/** Structural view of a BullMQ `Queue` (producer side). */
export interface ICNSBullQueueLike {
    add(
        name: string,
        data: object,
        opts?: Record<string, unknown>
    ): Promise<ICNSBullJob>;
}

// The job payload + response shapes are broker-agnostic — defined once in
// @cnstra/broker and re-exported here for back-compat.
export type { TCNSStimulationJobData, ICNSResponseLike } from '@cnstra/broker';
