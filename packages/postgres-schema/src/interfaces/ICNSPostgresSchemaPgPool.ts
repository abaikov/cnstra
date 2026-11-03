import type { ICNSPostgresSchemaConnection } from './ICNSPostgresSchemaConnection';

export interface ICNSPostgresSchemaPgPool {
    connect(): Promise<ICNSPostgresSchemaConnection & { release(error?: Error | boolean): void }>;
}
