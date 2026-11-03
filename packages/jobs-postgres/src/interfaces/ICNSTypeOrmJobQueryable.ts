export interface ICNSTypeOrmJobQueryable {
    query(query: string, parameters?: unknown[]): Promise<unknown>;
}
