import { CNSHomeostatBatchTransducer, CNSHomeostatTransductionEndpoint, CNSHomeostatTransductionFetch, CNSHomeostatTransductionQueryCodec } from '../index';
import type { ICNSHomeostatTransductionCodec } from '../index';
import { createCNSHomeostatTestDeckServer } from './support/cnsHomeostatTestSupport';

const jsonCodec: ICNSHomeostatTransductionCodec = {
    mediaType: 'application/json',
    encodeRequests: homeostatTransductionRequests => `q=${encodeURIComponent(JSON.stringify(homeostatTransductionRequests.map(({ name, key }) => [name, ...key])))}`,
    decodeRequests: encodedRequests => (JSON.parse(decodeURIComponent(encodedRequests.slice(2))) as [string, ...unknown[]][])
        .map(([name, ...key]) => ({ name, key })),
    encodeRows: homeostatTransductionRows => JSON.stringify(homeostatTransductionRows),
    decodeRows: encodedRows => JSON.parse(encodedRows),
};

const createEndpoint = (options: { maxUrlLength?: number; homeostatTransductionCodec?: ICNSHomeostatTransductionCodec; failingStatus?: number } = {}) => {
    const deckServer = createCNSHomeostatTestDeckServer();
    const homeostatTransductionEndpoint = new CNSHomeostatTransductionEndpoint({
        homeostatTransductionCodecs: [CNSHomeostatTransductionQueryCodec.INSTANCE, jsonCodec],
        batchTransduceFn: homeostatTransductionRequests => Promise.resolve(deckServer.joinDecksWithCards(homeostatTransductionRequests)),
    });
    const calls: { url: string; accept: string | undefined }[] = [];
    const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
        url: 'https://api.example.com/sync',
        homeostatTransductionCodec: options.homeostatTransductionCodec,
        maxUrlLength: options.maxUrlLength,
        headers: { authorization: 'Bearer t' },
        fetch: async (input, init) => {
            const url = String(input);
            const accept = (init?.headers as Record<string, string> | undefined)?.accept;
            calls.push({ url, accept });
            if (options.failingStatus !== undefined) return new Response('', { status: options.failingStatus });
            const response = await homeostatTransductionEndpoint.respond(url.slice(url.indexOf('?') + 1), accept);
            return new Response(response.body, { status: response.status, headers: response.headers });
        },
    });
    const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({ batchTransduceFn: homeostatTransductionFetch.batchTransduceFn });
    return {
        calls,
        transduceDeck: homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck),
        transduceDeckCards: homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deckCards', cards => cards),
    };
};

describe('one GET endpoint for every key of a screen', () => {
    it('fails each key of a GET whose answer the codec cannot decode with the url and the media type', async () => {
        const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({ url: 'https://api.example.com/sync', fetch: async () => new Response('<!doctype html>', { status: 200 }) });

        const rows = await homeostatTransductionFetch.batchTransduceFn([{ name: 'deck', key: ['d1'] }], new AbortController().signal);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'deck', key: ['d1'] });
        expect(String((rows[0] as { error: Error }).error.message)).toMatch(/^GET https:\/\/api\.example\.com\/sync\?.+: the answer is not /);
    });

    it('calls the fetch of globalThis at the time of the request, so a fetch replaced after construction answers', async () => {
        const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({ url: 'https://api.example.com/sync' });
        const originalFetch = globalThis.fetch;
        const urls: string[] = [];
        globalThis.fetch = async input => {
            urls.push(String(input));
            return new Response('', { status: 503 });
        };
        try {
            const rows = await homeostatTransductionFetch.batchTransduceFn([{ name: 'deck', key: ['d1'] }], new AbortController().signal);
            expect(urls).toHaveLength(1);
            expect(rows).toMatchObject([{ name: 'deck', key: ['d1'], error: { status: 503 } }]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('asks a deck and its cards in one GET with the query codec and answers each key from the flat list', async () => {
        const endpoint = createEndpoint();

        const [deck, deckCards] = await Promise.all([
            endpoint.transduceDeck(['d1'], new AbortController().signal),
            endpoint.transduceDeckCards(['d1'], new AbortController().signal),
        ]);

        expect(endpoint.calls).toEqual([{ url: 'https://api.example.com/sync?deck=d1&deckCards=d1', accept: 'application/vnd.cnstra.transduction-query.v1+json' }]);
        expect(deck).toEqual({ id: 'd1', title: 'Spades' });
        expect(deckCards).toEqual([{ id: 'c1', deck: 'd1', title: 'Ace' }]);
    });

    it('lets the endpoint pick the codec the client asks for', async () => {
        const endpoint = createEndpoint({ homeostatTransductionCodec: jsonCodec });

        await expect(endpoint.transduceDeck(['d2'], new AbortController().signal)).resolves.toEqual({ id: 'd2', title: 'Hearts' });
        expect(endpoint.calls).toEqual([{ url: `https://api.example.com/sync?q=${encodeURIComponent('[["deck","d2"]]')}`, accept: 'application/json' }]);
    });

    it('splits a query longer than maxUrlLength into several GETs that run together, the same split for the same keys in any order', async () => {
        const maxUrlLength = 'https://api.example.com/sync?'.length + 'deck=d1;deck=d2'.length;
        const endpoint = createEndpoint({ maxUrlLength });
        const backward = createEndpoint({ maxUrlLength });

        const answers = await Promise.all([
            endpoint.transduceDeck(['d1'], new AbortController().signal),
            endpoint.transduceDeck(['d2'], new AbortController().signal),
            endpoint.transduceDeckCards(['d1'], new AbortController().signal),
        ]);
        await Promise.all([
            backward.transduceDeckCards(['d1'], new AbortController().signal),
            backward.transduceDeck(['d2'], new AbortController().signal),
            backward.transduceDeck(['d1'], new AbortController().signal),
        ]);

        expect(backward.calls.map(call => call.url)).toEqual(endpoint.calls.map(call => call.url));

        expect(endpoint.calls.map(call => call.url)).toEqual([
            'https://api.example.com/sync?deck=d1;d2',
            'https://api.example.com/sync?deckCards=d1',
        ]);
        expect(answers).toEqual([{ id: 'd1', title: 'Spades' }, { id: 'd2', title: 'Hearts' }, [{ id: 'c1', deck: 'd1', title: 'Ace' }]]);
    });

    it('fails only the keys of a GET that fails, answers the keys of the other GETs, and fails a key it cannot encode without sending it', async () => {
        const urls: string[] = [];
        const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
            url: '/sync',
            maxUrlLength: '/sync?'.length + 'deck=d1'.length,
            headers: { Accept: 'text/html' },
            fetch: (input, init) => {
                urls.push(String(input));
                expect(init?.headers).toEqual({ accept: 'application/vnd.cnstra.transduction-query.v1+json' });
                return Promise.resolve(String(input).endsWith('d1') ? new Response('', { status: 414 }) : new Response('[[0,{"id":"d2"}]]'));
            },
        });

        const homeostatTransductionRows = await homeostatTransductionFetch.batchTransduceFn([
            { name: 'deck', key: ['d1'] },
            { name: 'deck', key: ['d2'] },
            { name: 'deck', key: [{ id: 'd3' }] },
        ], new AbortController().signal);

        expect(urls).toEqual(['/sync?deck=d1', '/sync?deck=d2']);
        expect(homeostatTransductionRows).toEqual([
            { name: 'deck', key: [{ id: 'd3' }], error: expect.objectContaining({ message: expect.stringContaining('a key part is object') }) },
            { name: 'deck', key: ['d1'], error: expect.objectContaining({ message: 'GET /sync?deck=d1: HTTP 414', status: 414 }) },
            { name: 'deck', key: ['d2'], data: { id: 'd2' } },
        ]);
    });

    it('fails only the keys of a GET that does not answer within timeoutMs, and answers the keys of the other GETs', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
                url: '/sync',
                maxUrlLength: '/sync?'.length + 'deck=d1'.length,
                timeoutMs: 1_000,
                fetch: (input, init) => {
                    if (String(input).endsWith('d2')) return Promise.resolve(new Response('[[0,{"id":"d2"}]]'));
                    return new Promise((_resolve, reject) => {
                        init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
                    });
                },
            });

            const transduced = homeostatTransductionFetch.batchTransduceFn([{ name: 'deck', key: ['d1'] }, { name: 'deck', key: ['d2'] }], new AbortController().signal);
            let isTransduced = false;
            void transduced.then(() => { isTransduced = true; });
            await jest.advanceTimersByTimeAsync(999);
            expect(isTransduced).toBe(false);
            await jest.advanceTimersByTimeAsync(1);

            await expect(transduced).resolves.toEqual([
                { name: 'deck', key: ['d1'], error: expect.objectContaining({ name: 'TimeoutError', message: 'GET /sync?deck=d1: timed out after 1000 ms' }) },
                { name: 'deck', key: ['d2'], data: { id: 'd2' } },
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('never times out a GET with timeoutMs Infinity and refuses a timeoutMs that is not above 0', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const abortController = new AbortController();
            const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
                url: '/sync',
                timeoutMs: Infinity,
                fetch: (_input, init) => new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
                }),
            });

            const transduced = homeostatTransductionFetch.batchTransduceFn([{ name: 'deck', key: ['d1'] }], abortController.signal);
            let isTransduced = false;
            void transduced.then(() => { isTransduced = true; }, () => { isTransduced = true; });
            await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
            expect(isTransduced).toBe(false);
            abortController.abort();
            await expect(transduced).rejects.toMatchObject({ name: 'AbortError' });
            expect(() => new CNSHomeostatTransductionFetch({ url: '/sync', timeoutMs: 0 })).toThrow('timeoutMs 0 is not a period a timer can wait');
        } finally {
            jest.useRealTimers();
        }
    });

    it('refuses a url with its own query or fragment, since the query belongs to the codec', () => {
        expect(() => new CNSHomeostatTransductionFetch({ url: '/sync?v=2' })).toThrow("the url '/sync?v=2' has a query or a fragment");
        expect(() => new CNSHomeostatTransductionFetch({ url: '/sync#top' })).toThrow('has a query or a fragment');
    });

    it('packs as many keys into each GET as fit, with many keys of one name', async () => {
        const urls: string[] = [];
        const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
            url: '/sync',
            maxUrlLength: 200,
            fetch: input => {
                urls.push(String(input));
                return Promise.resolve(new Response('[]'));
            },
        });
        const deckIds = Array.from({ length: 100 }, (_unused, index) => `d${String(index).padStart(3, '0')}`);

        await homeostatTransductionFetch.batchTransduceFn(deckIds.map(deckId => ({ name: 'deckCards', key: [deckId] })), new AbortController().signal);

        expect(urls.every(url => url.length <= 200)).toBe(true);
        expect(urls.map(url => url.slice('/sync?deckCards='.length).split(';')).flat()).toEqual(deckIds);
        expect(urls).toHaveLength(Math.ceil(deckIds.length / Math.floor((200 - '/sync?deckCards='.length + 1) / 'd000;'.length)));
    });

    it('leaves the cards of a deck out of the URL when the deck is asked and answers them from the deck, split or not', async () => {
        const coveringCodec = new CNSHomeostatTransductionQueryCodec({
            homeostatTransductionCovers: [{ coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey }],
        });
        const deckServer = createCNSHomeostatTestDeckServer();
        const homeostatTransductionEndpoint = new CNSHomeostatTransductionEndpoint({
            homeostatTransductionCodecs: [coveringCodec],
            batchTransduceFn: homeostatTransductionRequests => Promise.resolve(deckServer.joinDecksWithCards(homeostatTransductionRequests)),
        });
        const urls: string[] = [];
        const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
            url: '/sync',
            homeostatTransductionCodec: coveringCodec,
            maxUrlLength: '/sync?deck=d1'.length,
            fetch: async (input, init) => {
                const url = String(input);
                urls.push(url);
                const { status, headers, body } = await homeostatTransductionEndpoint.respond(url.slice(url.indexOf('?') + 1), (init?.headers as Record<string, string> | undefined)?.accept);
                return new Response(body, { status, headers });
            },
        });
        const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({ batchTransduceFn: homeostatTransductionFetch.batchTransduceFn });
        const transduceDeck = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck);
        const transduceDeckCards = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deckCards', cards => cards);

        const answers = await Promise.all([
            transduceDeckCards(['d2'], new AbortController().signal),
            transduceDeck(['d1'], new AbortController().signal),
            transduceDeckCards(['d1'], new AbortController().signal),
            transduceDeck(['d2'], new AbortController().signal),
        ]);

        expect(urls).toEqual(['/sync?deck=d1', '/sync?deck=d2']);
        expect(answers).toEqual([
            [{ id: 'c2', deck: 'd2', title: 'Two' }],
            { id: 'd1', title: 'Spades' },
            [{ id: 'c1', deck: 'd1', title: 'Ace' }],
            { id: 'd2', title: 'Hearts' },
        ]);
    });

    it('fails every key of a GET whose status is not 2xx', async () => {
        const endpoint = createEndpoint({ failingStatus: 503 });

        await expect(endpoint.transduceDeck(['d1'], new AbortController().signal)).rejects.toThrow('GET https://api.example.com/sync?deck=d1: HTTP 503');
    });
});
