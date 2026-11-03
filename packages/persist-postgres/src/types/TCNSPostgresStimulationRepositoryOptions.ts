import type { Pool } from 'pg';
import type { ICNSPgQueryable } from '../interfaces/ICNSPgQueryable';

export type TCNSPostgresStimulationRepositoryOptions = {
    connectionString?: string;
    pool?: Pool;
    queryable?: ICNSPgQueryable;
    tablePrefix?: string;
    autoMigrate?: boolean;
    now?: () => number;
};
