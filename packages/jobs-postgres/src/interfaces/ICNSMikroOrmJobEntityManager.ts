export interface ICNSMikroOrmJobEntityManager {
    execute(query: string, params?: unknown[]): Promise<unknown>;
}
