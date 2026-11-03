export interface ICNSPrismaJobTransaction {
    $queryRawUnsafe(query: string, ...values: unknown[]): PromiseLike<unknown>;
}
