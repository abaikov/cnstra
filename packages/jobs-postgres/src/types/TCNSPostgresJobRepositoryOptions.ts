import type { ICNSPostgresJobDatabase } from '../interfaces/ICNSPostgresJobDatabase';

export type TCNSPostgresJobRepositoryOptions = {
    database: ICNSPostgresJobDatabase;
    tablePrefix?: string;
    history?: boolean;
    now?: () => number;
    generateJobId?: () => string;
    onError?: (error: unknown) => void;
};
