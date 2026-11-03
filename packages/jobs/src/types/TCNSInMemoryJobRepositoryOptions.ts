import type { ICNSJobLogRepository } from '../interfaces/ICNSJobLogRepository';

export type TCNSInMemoryJobRepositoryOptions = {
    now?: () => number;
    generateJobId?: () => string;
    history?: boolean;
    logRepository?: ICNSJobLogRepository;
    onError?: (error: unknown) => void;
};
