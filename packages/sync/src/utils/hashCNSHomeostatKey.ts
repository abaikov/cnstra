export function hashCNSHomeostatKey(key: readonly unknown[]): string {
    return JSON.stringify(key);
}
