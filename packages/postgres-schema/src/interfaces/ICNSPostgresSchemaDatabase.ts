import type { ICNSPostgresSchemaConnection } from './ICNSPostgresSchemaConnection';

export interface ICNSPostgresSchemaDatabase {
    transaction<TResult>(work: (connection: ICNSPostgresSchemaConnection) => Promise<TResult>): Promise<TResult>;
}
