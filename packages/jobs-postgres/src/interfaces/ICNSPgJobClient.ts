export interface ICNSPgJobClient {
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}
