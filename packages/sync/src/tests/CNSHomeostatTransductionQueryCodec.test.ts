import { CNSHomeostatTransductionQueryCodec } from '../index';

const homeostatTransductionCodec = CNSHomeostatTransductionQueryCodec.INSTANCE;

describe('the query codec of one GET endpoint', () => {
    it('writes one sorted, deduplicated query: names, then keys, parts by comma, keys by semicolon', () => {
        expect(homeostatTransductionCodec.encodeRequests([
            { name: 'deckCards', key: ['d2'] },
            { name: 'deck', key: ['d2'] },
            { name: 'deckCards', key: ['d1'] },
            { name: 'deck', key: ['d1'] },
            { name: 'deck', key: ['d1'] },
        ])).toBe('deck=d1;d2&deckCards=d1;d2');
    });

    it('gives the same query for the same keys in any order, so a cache can keep the answer', () => {
        const forward = homeostatTransductionCodec.encodeRequests([{ name: 'deck', key: ['d1'] }, { name: 'deckCards', key: ['d1'] }]);
        const backward = homeostatTransductionCodec.encodeRequests([{ name: 'deckCards', key: ['d1'] }, { name: 'deck', key: ['d1'] }]);

        expect(forward).toBe(backward);
    });

    it('reads back every kind of key part: strings with separators, an empty string, a leading tilde, numbers, undefined, an empty key', () => {
        const homeostatTransductionRequests = [
            { name: 'cardsPage', key: ['d1', undefined, 20] },
            { name: 'cardsPage', key: ['d1', 'c,9;x&y=z', -1.5] },
            { name: 'search', key: ['', '~home', 'кириллица'] },
            { name: 'me', key: [] },
        ];

        const encodedRequests = homeostatTransductionCodec.encodeRequests(homeostatTransductionRequests);

        expect(encodedRequests).toBe('cardsPage=d1,c%2C9%3Bx%26y%3Dz,~-1.5;d1,~,~20&me=&search=~e,~~home,%D0%BA%D0%B8%D1%80%D0%B8%D0%BB%D0%BB%D0%B8%D1%86%D0%B0');
        expect(homeostatTransductionCodec.decodeRequests(encodedRequests)).toEqual([
            { name: 'cardsPage', key: ['d1', 'c,9;x&y=z', -1.5] },
            { name: 'cardsPage', key: ['d1', undefined, 20] },
            { name: 'me', key: [] },
            { name: 'search', key: ['', '~home', 'кириллица'] },
        ]);
    });

    it('keeps apart what only looks alike: the string 1 and the number 1, a lone tilde, a name with =, big numbers, booleans and null', () => {
        const homeostatTransductionRequests = [
            { name: 'a=b', key: ['1'] },
            { name: 'a=b', key: [1] },
            { name: 'a=b', key: ['~'] },
            { name: 'a=b', key: [1e21, -Infinity, Number.NaN] },
            { name: 'a=b', key: [true, false, null] },
        ];

        const encodedRequests = homeostatTransductionCodec.encodeRequests(homeostatTransductionRequests);

        expect(encodedRequests).toBe('a%3Db=1;~1;~1e%2B21,~-Infinity,~NaN;~t,~f,~n;~~');
        expect(homeostatTransductionCodec.decodeRequests(encodedRequests)).toEqual([
            { name: 'a=b', key: ['1'] },
            { name: 'a=b', key: [1] },
            { name: 'a=b', key: [1e21, -Infinity, Number.NaN] },
            { name: 'a=b', key: [true, false, null] },
            { name: 'a=b', key: ['~'] },
        ]);
    });

    it('answers with a flat list of [request, data] and [request, null, error] and reads it back into rows', () => {
        const encodedRequests = homeostatTransductionCodec.encodeRequests([{ name: 'deck', key: ['d1'] }, { name: 'deckCards', key: ['d1'] }, { name: 'deck', key: ['d9'] }]);

        const encodedRows = homeostatTransductionCodec.encodeRows([
            { name: 'deck', key: ['d1'], data: { id: 'd1' } },
            { name: 'deckCards', key: ['d1'], data: { id: 'c1' } },
            { name: 'deckCards', key: ['d1'], data: { id: 'c2' } },
            { name: 'deck', key: ['d9'], error: { status: 404 } },
        ], encodedRequests);

        expect(encodedRows).toBe('[[0,{"id":"d1"}],[2,{"id":"c1"}],[2,{"id":"c2"}],[1,null,{"status":404}]]');
        expect(homeostatTransductionCodec.encodeRows([{ name: 'deckCards', key: ['d1'] }, { name: 'deck', key: ['d9'], error: new TypeError('gone') }], encodedRequests))
            .toBe('[[2],[1,null,{"name":"TypeError","message":"gone"}]]');
        expect(homeostatTransductionCodec.decodeRows('[[2]]', encodedRequests)).toEqual([{ name: 'deckCards', key: ['d1'] }]);
        expect(homeostatTransductionCodec.decodeRows(encodedRows, encodedRequests)).toEqual([
            { name: 'deck', key: ['d1'], data: { id: 'd1' } },
            { name: 'deckCards', key: ['d1'], data: { id: 'c1' } },
            { name: 'deckCards', key: ['d1'], data: { id: 'c2' } },
            { name: 'deck', key: ['d9'], error: { status: 404 } },
        ]);
    });

    it('leaves a covered key out of the query when its covering key is in the batch, and reads it back on both sides', () => {
        const coveringCodec = new CNSHomeostatTransductionQueryCodec({
            homeostatTransductionCovers: [{ coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey }],
        });

        const encodedRequests = coveringCodec.encodeRequests([
            { name: 'deck', key: ['d1'] },
            { name: 'deckCards', key: ['d1'] },
            { name: 'deckCards', key: ['d2'] },
        ]);

        expect(encodedRequests).toBe('deck=d1&deckCards=d2');
        expect(coveringCodec.decodeRequests(encodedRequests)).toEqual([
            { name: 'deck', key: ['d1'] },
            { name: 'deckCards', key: ['d2'] },
            { name: 'deckCards', key: ['d1'] },
        ]);
        const encodedRows = coveringCodec.encodeRows([
            { name: 'deck', key: ['d1'], data: { id: 'd1' } },
            { name: 'deckCards', key: ['d1'], data: { id: 'c1' } },
        ], encodedRequests);
        expect(encodedRows).toBe('[[0,{"id":"d1"}],[2,{"id":"c1"}]]');
        expect(coveringCodec.decodeRows(encodedRows, encodedRequests)).toEqual([
            { name: 'deck', key: ['d1'], data: { id: 'd1' } },
            { name: 'deckCards', key: ['d1'], data: { id: 'c1' } },
        ]);
    });

    it('follows a cover of a cover, leaves out a key covered through the chain, and refuses a cycle of covers', () => {
        const chainCodec = new CNSHomeostatTransductionQueryCodec({
            homeostatTransductionCovers: [
                { coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey },
                { coveringName: 'deckCards', coveredName: 'deckCardsCount', selectCoveredKey: deckKey => deckKey },
            ],
        });

        const encodedRequests = chainCodec.encodeRequests([
            { name: 'deckCardsCount', key: ['d1'] },
            { name: 'deckCards', key: ['d2'] },
            { name: 'deck', key: ['d1'] },
            { name: 'deckCardsCount', key: ['d2'] },
        ]);

        expect(encodedRequests).toBe('deck=d1&deckCards=d2');
        expect(chainCodec.decodeRequests(encodedRequests)).toEqual([
            { name: 'deck', key: ['d1'] },
            { name: 'deckCards', key: ['d2'] },
            { name: 'deckCards', key: ['d1'] },
            { name: 'deckCardsCount', key: ['d2'] },
            { name: 'deckCardsCount', key: ['d1'] },
        ]);
        expect(() => new CNSHomeostatTransductionQueryCodec({
            homeostatTransductionCovers: [
                { coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey },
                { coveringName: 'deckCards', coveredName: 'deck', selectCoveredKey: deckKey => deckKey },
            ],
        })).toThrow('deck covers itself through a cycle');
    });

    it('names its covers in its media type, so an endpoint with other covers answers 406 instead of filing rows under wrong keys', () => {
        const deckCover = { coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: (deckKey: readonly unknown[]) => deckKey };

        expect(new CNSHomeostatTransductionQueryCodec({ homeostatTransductionCovers: [deckCover] }).mediaType).toMatch(/^application\/vnd\.cnstra\.transduction-query\.v1\.covers-[0-9a-f]{8}\+json$/);
        expect(new CNSHomeostatTransductionQueryCodec({ homeostatTransductionCovers: [deckCover] }).mediaType).not.toBe(homeostatTransductionCodec.mediaType);
    });

    it('drops a row for a key that was not asked, so only that key fails on the client, and keeps the fields of an error', () => {
        expect(homeostatTransductionCodec.encodeRows([
            { name: 'deck', key: [1], data: {} },
            { name: 'deck', key: ['1'], error: Object.assign(new Error('Not found'), { status: 404 }) },
        ], 'deck=1')).toBe('[[0,null,{"status":404,"name":"Error","message":"Not found"}]]');
    });

    it('puts the revision of a cover in the media type, so a changed selectCoveredKey can be told apart', () => {
        const deckCover = { coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: (deckKey: readonly unknown[]) => deckKey };

        expect(new CNSHomeostatTransductionQueryCodec({ homeostatTransductionCovers: [{ ...deckCover, revision: '2' }] }).mediaType)
            .not.toBe(new CNSHomeostatTransductionQueryCodec({ homeostatTransductionCovers: [deckCover] }).mediaType);
    });

    it('refuses what it cannot carry or read', () => {
        expect(() => homeostatTransductionCodec.encodeRequests([{ name: 'deck', key: [{}] }])).toThrow('a key part is object');
        expect(() => homeostatTransductionCodec.decodeRequests('deck=~0x10')).toThrow("'~0x10' is not a key part");
        expect(() => homeostatTransductionCodec.decodeRequests('deck')).toThrow("no '=' in 'deck'");
        expect(() => homeostatTransductionCodec.decodeRequests('deck=~x')).toThrow("'~x' is not a key part");
        expect(() => homeostatTransductionCodec.decodeRows('[[5,{}]]', 'deck=d1')).toThrow('row 0: no request 5');
        expect(() => homeostatTransductionCodec.decodeRows('[[]]', 'deck=d1')).toThrow('row 0: not [request], [request, data] or [request, null, error]');
    });
});
