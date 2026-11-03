import type { ECNSPostgresSchemaStepKind } from './ECNSPostgresSchemaStepKind';

export type TCNSPostgresSchemaStep = {
    readonly step: number;
    readonly kind: ECNSPostgresSchemaStepKind;
    readonly sql: (tablePrefix: string) => string;
};
