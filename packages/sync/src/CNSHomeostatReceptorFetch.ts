import type { TCNSHomeostatReceptorFetchOptions } from './types/TCNSHomeostatReceptorFetchOptions';
import type { TCNSHomeostatReceptorRequest } from './types/TCNSHomeostatReceptorRequest';
import { CNSHomeostatRequestTimeout } from './CNSHomeostatRequestTimeout';

export class CNSHomeostatReceptorFetch {
    private readonly fetch: typeof globalThis.fetch;

    private readonly baseUrl: string;

    private readonly headers: Record<string, string>;

    private readonly homeostatRequestTimeout: CNSHomeostatRequestTimeout;

    public constructor(options?: TCNSHomeostatReceptorFetchOptions) {
        this.fetch = options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.baseUrl = options?.baseUrl ?? '';
        this.headers = options?.headers ?? {};
        this.homeostatRequestTimeout = new CNSHomeostatRequestTimeout(options?.timeoutMs ?? 30_000, 'homeostat receptor fetch');
    }

    public async send(homeostatReceptorRequest: TCNSHomeostatReceptorRequest, abortSignal: AbortSignal | undefined): Promise<unknown> {
        const hasBody = homeostatReceptorRequest.body !== undefined;
        const method = homeostatReceptorRequest.method ?? 'GET';
        const requestSignal = this.homeostatRequestTimeout.signalOf(abortSignal, () => `${method} ${homeostatReceptorRequest.url}`);
        const headers = new Headers(this.headers);
        for (const [name, value] of Object.entries(homeostatReceptorRequest.headers ?? {})) headers.set(name, value);
        if (hasBody && !headers.has('content-type')) headers.set('content-type', 'application/json');
        try {
            const response = await this.fetch(this.baseUrl + homeostatReceptorRequest.url, {
                method,
                headers: Object.fromEntries(headers),
                body: hasBody ? JSON.stringify(homeostatReceptorRequest.body) : undefined,
                signal: requestSignal.signal,
            });
            if (!response.ok) throw Object.assign(new Error(`${method} ${homeostatReceptorRequest.url}: HTTP ${response.status}`), { status: response.status });
            const body = await response.text();
            if (body.trim() === '') return undefined;
            try {
                return JSON.parse(body);
            } catch (error) {
                throw Object.assign(new Error(`${method} ${homeostatReceptorRequest.url}: the answer is not JSON`), { cause: error });
            }
        } finally {
            requestSignal.clear();
        }
    }
}
