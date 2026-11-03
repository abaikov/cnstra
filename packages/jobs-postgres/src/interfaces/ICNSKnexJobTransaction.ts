export interface ICNSKnexJobTransaction {
    raw(sql: string, bindings: readonly unknown[]): PromiseLike<{ rows?: unknown[] }>;
}
