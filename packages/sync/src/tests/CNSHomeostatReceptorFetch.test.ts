import { CNSHomeostatReceptorFetch } from '../index';

const fetchReturning = (status: number, body: unknown, calls: { url: string; init: RequestInit | undefined }[]): typeof globalThis.fetch =>
    async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(body), { status });
    };

describe('the fetch helper of a receptor', () => {
    it('sends a request with the base url, method, json body and merged headers', async () => {
        const calls: { url: string; init: RequestInit | undefined }[] = [];
        const homeostatReceptorFetch = new CNSHomeostatReceptorFetch({
            fetch: fetchReturning(200, { id: 'd1' }, calls),
            baseUrl: 'https://api.example.com',
            headers: { authorization: 'Bearer t' },
        });

        const fetched = await homeostatReceptorFetch.send({ url: '/decks/d1' }, undefined);
        await homeostatReceptorFetch.send({ url: '/decks/d1', method: 'POST', body: { title: 'Spanish' }, headers: { 'x-trace': '1' } }, undefined);

        expect(fetched).toEqual({ id: 'd1' });
        expect(calls[0]).toMatchObject({ url: 'https://api.example.com/decks/d1', init: { method: 'GET', body: undefined } });
        expect(Object.fromEntries(new Headers(calls[0]?.init?.headers))).toEqual({ authorization: 'Bearer t' });
        expect(calls[1]).toMatchObject({ init: { method: 'POST', body: '{"title":"Spanish"}' } });
        expect(Object.fromEntries(new Headers(calls[1]?.init?.headers))).toEqual({ 'content-type': 'application/json', authorization: 'Bearer t', 'x-trace': '1' });
    });

    it('sends one content-type when the caller names it in any letter case', async () => {
        const calls: { url: string; init: RequestInit | undefined }[] = [];
        const homeostatReceptorFetch = new CNSHomeostatReceptorFetch({ fetch: fetchReturning(200, {}, calls), headers: { 'Content-Type': 'application/merge-patch+json' } });

        await homeostatReceptorFetch.send({ url: '/decks/d1', method: 'PATCH', body: { title: 'Spanish' } }, undefined);
        await homeostatReceptorFetch.send({ url: '/decks/d1', method: 'PATCH', body: {}, headers: { 'CONTENT-TYPE': 'application/vnd.deck+json' } }, undefined);

        expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/merge-patch+json');
        expect(new Headers(calls[1]?.init?.headers).get('content-type')).toBe('application/vnd.deck+json');
    });

    it('calls the fetch of globalThis at the time of the request, so a fetch replaced after construction answers', async () => {
        const homeostatReceptorFetch = new CNSHomeostatReceptorFetch();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchReturning(200, { id: 'mocked' }, []);
        try {
            await expect(homeostatReceptorFetch.send({ url: '/decks/d1' }, undefined)).resolves.toEqual({ id: 'mocked' });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('rejects a request whose status is not 2xx', async () => {
        const homeostatReceptorFetch = new CNSHomeostatReceptorFetch({ fetch: fetchReturning(503, {}, []) });

        await expect(homeostatReceptorFetch.send({ url: '/decks/d1' }, undefined)).rejects.toThrow('GET /decks/d1: HTTP 503');
    });

    it('rejects an answer that is not JSON with the method and the url, and keeps the parse error as its cause', async () => {
        const homeostatReceptorFetch = new CNSHomeostatReceptorFetch({ fetch: async () => new Response('<!doctype html>', { status: 200 }) });

        await expect(homeostatReceptorFetch.send({ url: '/decks/d1' }, undefined)).rejects.toMatchObject({
            message: 'GET /decks/d1: the answer is not JSON',
            cause: expect.any(SyntaxError),
        });
    });

    it('resolves an answer without a body, such as 204, with undefined', async () => {
        const homeostatReceptorFetch = new CNSHomeostatReceptorFetch({ fetch: async () => new Response(null, { status: 204 }) });

        await expect(homeostatReceptorFetch.send({ url: '/decks/d1', method: 'DELETE' }, undefined)).resolves.toBeUndefined();
    });

    it('rejects a request that does not answer within timeoutMs, and keeps the caller abort as its own reason', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const homeostatReceptorFetch = new CNSHomeostatReceptorFetch({
                timeoutMs: 1_000,
                fetch: (_input, init) => new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
                }),
            });

            const timedOut = homeostatReceptorFetch.send({ url: '/decks/d1', method: 'POST', body: {} }, undefined);
            const rejected = expect(timedOut).rejects.toMatchObject({ name: 'TimeoutError', message: 'POST /decks/d1: timed out after 1000 ms' });
            await jest.advanceTimersByTimeAsync(1_000);
            await rejected;

            const abortController = new AbortController();
            const aborted = homeostatReceptorFetch.send({ url: '/decks/d1' }, abortController.signal);
            abortController.abort(new Error('left the screen'));
            await expect(aborted).rejects.toThrow('left the screen');
            expect(() => new CNSHomeostatReceptorFetch({ timeoutMs: -1 })).toThrow('timeoutMs -1 is not a period a timer can wait');
        expect(() => new CNSHomeostatReceptorFetch({ timeoutMs: 2 ** 31 })).toThrow('at most 2147483647');
        } finally {
            jest.useRealTimers();
        }
    });
});
