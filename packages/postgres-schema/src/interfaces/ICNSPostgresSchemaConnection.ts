export interface ICNSPostgresSchemaConnection {
    query<TRow = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: TRow[] }>;
}
