export interface ICNSPgQueryable {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
