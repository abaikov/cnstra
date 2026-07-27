import type { ICNSProgressRepository } from './interfaces/ICNSProgressRepository';
import type { TCNSProgress } from '@cnstra/persist-dto';

/**
 * In-memory progress repository — for tests, single-process dev, and as the
 * reference implementation of {@link ICNSProgressRepository}. Not durable across a
 * process restart; use a Postgres/Redis adapter for production.
 */
export class CNSInMemoryProgressRepository implements ICNSProgressRepository {
    private readonly store = new Map<string, TCNSProgress>();

    async save(key: string, progress: TCNSProgress): Promise<void> {
        this.store.set(key, progress);
    }

    async load(key: string): Promise<TCNSProgress | undefined> {
        return this.store.get(key);
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    /** Test/introspection helper: number of stored records. */
    size(): number {
        return this.store.size;
    }
}
