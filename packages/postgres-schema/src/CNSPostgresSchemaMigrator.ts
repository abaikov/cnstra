import type { ICNSPostgresSchemaConnection } from './interfaces/ICNSPostgresSchemaConnection';
import type { ICNSPostgresSchemaDatabase } from './interfaces/ICNSPostgresSchemaDatabase';
import type { ECNSPostgresSchemaStepKind } from './types/ECNSPostgresSchemaStepKind';
import type { TCNSPostgresSchemaMigrateOptions } from './types/TCNSPostgresSchemaMigrateOptions';
import type { TCNSPostgresSchemaMigratorOptions } from './types/TCNSPostgresSchemaMigratorOptions';
import type { TCNSPostgresSchemaStep } from './types/TCNSPostgresSchemaStep';

export class CNSPostgresSchemaMigrator {
    static readonly LOCK_NAMESPACE = 6;
    static readonly LOCK_TIMEOUT = '5s';
    static readonly MAX_IDENTIFIER_LENGTH = 63;

    private readonly steps: readonly TCNSPostgresSchemaStep[];

    constructor(private readonly options: TCNSPostgresSchemaMigratorOptions) {
        this.steps = [...options.steps].sort((left, right) => left.step - right.step);
        this.steps.forEach((step, index) => {
            if (step.step !== index + 1) throw new Error(`[${options.name}] schema steps must be numbered 1, 2, 3…; found ${step.step} at position ${index + 1}`);
        });
        if (this.steps[0]?.kind !== 'expand') throw new Error(`[${options.name}] schema step 1 must be an expand step`);
    }

    migrationTable(tablePrefix: string): string {
        return `${tablePrefix}${this.options.name}_migration`;
    }

    async migrate(database: ICNSPostgresSchemaDatabase, tablePrefix: string, options: TCNSPostgresSchemaMigrateOptions = {}): Promise<void> {
        await database.transaction(async connection => {
            await connection.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CNSPostgresSchemaMigrator.LOCK_NAMESPACE, tablePrefix + this.options.name]);
            await connection.query(`SET LOCAL lock_timeout = '${CNSPostgresSchemaMigrator.LOCK_TIMEOUT}'`);
            const applied = await this.readAppliedSteps(connection, tablePrefix);
            if (applied === undefined) await this.assertNoUntrackedTables(connection, tablePrefix);
            const pending = this.pendingSteps(applied ?? new Map(), applied === undefined || options.contract === true);
            if (pending.length > 0) await connection.query(this.sqlFor(tablePrefix, pending, applied === undefined));
        });
    }

    async verify(connection: ICNSPostgresSchemaConnection, tablePrefix: string): Promise<void> {
        const applied = await this.readAppliedSteps(connection, tablePrefix);
        if (applied === undefined) {
            throw new Error(`[${this.options.name}] the schema is not installed under prefix "${tablePrefix}": run migrate()`);
        }
        const missing = this.steps.filter(step => step.kind === 'expand' && !applied.has(step.step)).map(step => step.step);
        if (missing.length > 0) {
            throw new Error(`[${this.options.name}] schema steps ${missing.join(', ')} are not applied under prefix "${tablePrefix}": run migrate()`);
        }
        const unknown = [...applied].filter(([step, kind]) => kind === 'contract' && step > this.steps.length).map(([step]) => step);
        if (unknown.length > 0) {
            throw new Error(`[${this.options.name}] the database has contract steps ${unknown.join(', ')} that this version does not know: upgrade the package`);
        }
    }

    migrationSql(tablePrefix: string, appliedSteps: readonly number[] = [], options: TCNSPostgresSchemaMigrateOptions = {}): string {
        const fresh = appliedSteps.length === 0;
        const applied = new Map<number, ECNSPostgresSchemaStepKind>(appliedSteps.map(step => [step, 'expand']));
        return this.sqlFor(tablePrefix, this.pendingSteps(applied, fresh || options.contract === true), fresh);
    }

    assertTablePrefix(tablePrefix: string, longestSuffix: string): string {
        const longest = Math.max(longestSuffix.length, `${this.options.name}_migration`.length);
        const limit = CNSPostgresSchemaMigrator.MAX_IDENTIFIER_LENGTH - longest;
        if (!new RegExp(`^[A-Za-z_][A-Za-z0-9_]{0,${limit - 1}}$`).test(tablePrefix)) {
            throw new Error(`[${this.options.name}] unsafe table prefix ${JSON.stringify(tablePrefix)}: letters, digits and _ only, at most ${limit} characters`);
        }
        return tablePrefix;
    }

    private pendingSteps(applied: ReadonlyMap<number, ECNSPostgresSchemaStepKind>, withContract: boolean): TCNSPostgresSchemaStep[] {
        return this.steps.filter(step => !applied.has(step.step) && (step.kind === 'expand' || withContract));
    }

    private sqlFor(tablePrefix: string, steps: readonly TCNSPostgresSchemaStep[], createMigrationTable: boolean): string {
        const table = this.migrationTable(tablePrefix);
        const parts = createMigrationTable
            ? [`CREATE TABLE ${table} (step integer PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('expand', 'contract')));`]
            : [];
        for (const step of steps) {
            parts.push(step.sql(tablePrefix), `INSERT INTO ${table} (step, kind) VALUES (${step.step}, '${step.kind}');`);
        }
        return parts.join('\n');
    }

    private async readAppliedSteps(connection: ICNSPostgresSchemaConnection, tablePrefix: string): Promise<Map<number, ECNSPostgresSchemaStepKind> | undefined> {
        const table = this.migrationTable(tablePrefix);
        const exists = await connection.query<{ found: string | null }>('SELECT to_regclass($1)::text AS found', [table]);
        if (exists.rows[0]?.found == null) return undefined;
        const rows = await connection.query<{ step: number; kind: ECNSPostgresSchemaStepKind }>(`SELECT step, kind FROM ${table}`);
        return new Map(rows.rows.map(row => [Number(row.step), row.kind]));
    }

    private async assertNoUntrackedTables(connection: ICNSPostgresSchemaConnection, tablePrefix: string): Promise<void> {
        const tables = this.options.tables(tablePrefix);
        const found = await connection.query<{ name: string }>(
            'SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NOT NULL',
            [tables]
        );
        if (found.rows.length > 0) {
            throw new Error(
                `[${this.options.name}] tables ${found.rows.map(row => row.name).join(', ')} exist without ${this.migrationTable(tablePrefix)}: they were created by an earlier unversioned release; drop them or move the data before migrate()`
            );
        }
    }
}
