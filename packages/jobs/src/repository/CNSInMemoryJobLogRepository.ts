import type { ICNSJobLogRepository } from '../interfaces/ICNSJobLogRepository';
import { CNSJobCompositeKey } from '../job/CNSJobCompositeKey';
import { CNSJobJsonValue } from '../job/CNSJobJsonValue';
import type { TCNSJobLogEntry } from '../types/TCNSJobLogEntry';
import type { TCNSJobLogQuery } from '../types/TCNSJobLogQuery';

export class CNSInMemoryJobLogRepository implements ICNSJobLogRepository {
    private static byPosition(a: TCNSJobLogEntry, b: TCNSJobLogEntry): number {
        return a.attemptNumber - b.attemptNumber || a.seq - b.seq;
    }

    private static positionOf(entry: TCNSJobLogEntry): string {
        return CNSJobCompositeKey.of(entry.attemptNumber, entry.seq, entry.at);
    }

    private readonly entries = new Map<string, TCNSJobLogEntry[]>();

    async append(jobId: string, entries: readonly TCNSJobLogEntry[]): Promise<void> {
        if (entries.length === 0) return;
        const kept = this.entries.get(jobId) ?? [];
        const stored = new Set(kept.map(CNSInMemoryJobLogRepository.positionOf));
        kept.push(...CNSJobJsonValue.copy(entries.filter(entry => !stored.has(CNSInMemoryJobLogRepository.positionOf(entry)))));
        kept.sort(CNSInMemoryJobLogRepository.byPosition);
        this.entries.set(jobId, kept);
    }

    async list(jobId: string, query: TCNSJobLogQuery = {}): Promise<TCNSJobLogEntry[]> {
        const after = query.after;
        const found = (this.entries.get(jobId) ?? []).filter(
            entry =>
                (query.attemptNumber === undefined || entry.attemptNumber === query.attemptNumber) &&
                (!after || CNSInMemoryJobLogRepository.byPosition(entry, { ...after, at: 0, kind: '' }) > 0)
        );
        return structuredClone(query.limit === undefined ? found : found.slice(0, query.limit));
    }

    async delete(jobIds: readonly string[]): Promise<void> {
        for (const jobId of jobIds) this.entries.delete(jobId);
    }
}
