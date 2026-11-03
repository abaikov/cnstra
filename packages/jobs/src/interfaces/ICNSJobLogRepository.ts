import type { TCNSJobLogEntry } from '../types/TCNSJobLogEntry';
import type { TCNSJobLogQuery } from '../types/TCNSJobLogQuery';

export interface ICNSJobLogRepository {
    append(jobId: string, entries: readonly TCNSJobLogEntry[]): Promise<void>;
    list(jobId: string, query?: TCNSJobLogQuery): Promise<TCNSJobLogEntry[]>;
    delete(jobIds: readonly string[]): Promise<void>;
}
