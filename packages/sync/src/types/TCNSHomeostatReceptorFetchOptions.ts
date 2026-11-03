export type TCNSHomeostatReceptorFetchOptions = {
    fetch?: typeof globalThis.fetch;
    baseUrl?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
};
