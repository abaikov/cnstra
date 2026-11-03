import type { TCNSPostgresSchemaStep } from './TCNSPostgresSchemaStep';

export type TCNSPostgresSchemaMigratorOptions = {
    readonly name: string;
    readonly steps: readonly TCNSPostgresSchemaStep[];
    readonly tables: (tablePrefix: string) => readonly string[];
};
