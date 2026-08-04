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
    /** 0-based retry count (pg-boss `Job.retryCount`); drives the attempt number. */
    retryCount?: number;
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

// The job payload + response shapes are broker-agnostic — defined once in
// @cnstra/broker and re-exported here for back-compat.
export type { TCNSStimulationJobData, ICNSResponseLike } from '@cnstra/broker';
