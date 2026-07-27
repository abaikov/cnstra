import type { TCNSProgress } from '@cnstra/persist-dto';

/**
 * Durable store for progress, keyed by an opaque id (e.g. the queue job id or
 * stimulation id). One mutable record per key — `save` upserts. The single adapter
 * seam: in-memory, Postgres, Redis, or "inside the job" all implement it, so
 * progress never depends on a particular queue or database. The record's lifecycle
 * (creation, cleanup) is the integration's concern — e.g. tied to the pg-boss job.
 */
export interface ICNSProgressRepository {
    save(key: string, progress: TCNSProgress): Promise<void>;
    load(key: string): Promise<TCNSProgress | undefined>;
    delete(key: string): Promise<void>;
}
