import { CNSHomeostatTransductionEndpoint, CNSHomeostatTransductionQueryCodec } from '../index';
import type { ICNSHomeostatTransductionCodec } from '../index';
import { createCNSHomeostatTestDeckServer } from './support/cnsHomeostatTestSupport';

const queryCodec = CNSHomeostatTransductionQueryCodec.INSTANCE;
const compactCodec: ICNSHomeostatTransductionCodec = { mediaType: 'application/x-compact', encodeRequests: queryCodec.encodeRequests.bind(queryCodec), decodeRequests: queryCodec.decodeRequests.bind(queryCodec), encodeRows: () => 'compact', decodeRows: () => [] };

const createEndpoint = () => {
    const deckServer = createCNSHomeostatTestDeckServer();
    return new CNSHomeostatTransductionEndpoint({
        homeostatTransductionCodecs: [queryCodec, compactCodec],
        batchTransduceFn: homeostatTransductionRequests => Promise.resolve(deckServer.joinDecksWithCards(homeostatTransductionRequests)),
    });
};

describe('the /sync endpoint picks its codec', () => {
    it('answers with the first codec when the client accepts anything or says nothing', async () => {
        const endpoint = createEndpoint();

        const answered = [await endpoint.respond('deck=d1', undefined), await endpoint.respond('deck=d1', '*/*')];

        expect(answered).toEqual([0, 1].map(() => ({
            status: 200,
            headers: { 'content-type': 'application/vnd.cnstra.transduction-query.v1+json', vary: 'accept' },
            body: '[[0,{"id":"d1","title":"Spades"}]]',
        })));
    });

    it('answers with the codec of the highest q, whatever order the client lists them in', async () => {
        const endpoint = createEndpoint();

        const answered = [
            await endpoint.respond('deck=d1', 'application/x-compact;q=0.9, application/vnd.cnstra.transduction-query.v1+json'),
            await endpoint.respond('deck=d1', 'application/vnd.cnstra.transduction-query.v1+json;q=0.5, application/x-compact;q=0.9'),
        ];

        expect(answered.map(answer => answer.headers['content-type'])).toEqual(['application/vnd.cnstra.transduction-query.v1+json', 'application/x-compact']);
    });

    it("breaks a q tie by the server's codec order, not by the order the client lists them in", async () => {
        const endpoint = createEndpoint();

        const answered = await endpoint.respond('deck=d1', 'application/x-compact, application/vnd.cnstra.transduction-query.v1+json');

        expect(answered.headers['content-type']).toBe('application/vnd.cnstra.transduction-query.v1+json');
    });

    it('lets the most specific matching media range decide the q of a codec', async () => {
        const endpoint = createEndpoint();

        const answered = [
            await endpoint.respond('deck=d1', 'application/x-compact, */*;q=0.1'),
            await endpoint.respond('deck=d1', 'application/vnd.cnstra.transduction-query.v1+json;q=0, */*'),
        ];

        expect(answered).toEqual([0, 1].map(() => ({ status: 200, headers: { 'content-type': 'application/x-compact', vary: 'accept' }, body: 'compact' })));
    });

    it('matches a type/* range and media types in any case', async () => {
        const endpoint = createEndpoint();

        const answered = [await endpoint.respond('deck=d1', 'application/*'), await endpoint.respond('deck=d1', 'APPLICATION/X-COMPACT')];

        expect(answered.map(answer => answer.headers['content-type'])).toEqual(['application/vnd.cnstra.transduction-query.v1+json', 'application/x-compact']);
    });

    it('answers 406 when the client accepts anything only with q=0', async () => {
        const endpoint = createEndpoint();

        const answered = await endpoint.respond('deck=d1', '*/*;q=0');

        expect(answered.status).toBe(406);
    });

    it('answers 406 with the media types it has when it has none the client accepts, and 400 for a query it cannot read', async () => {
        const endpoint = createEndpoint();

        await expect(endpoint.respond('deck=d1', 'application/xml')).resolves.toEqual({
            status: 406,
            headers: { 'content-type': 'text/plain', vary: 'accept' },
            body: 'accept one of: application/vnd.cnstra.transduction-query.v1+json, application/x-compact',
        });
        await expect(endpoint.respond('deck', undefined)).resolves.toMatchObject({ status: 400, body: "homeostat transduction requests: no '=' in 'deck'" });
    });

    it('answers 406 to a client whose codec has other covers', async () => {
        const coveringCodec = new CNSHomeostatTransductionQueryCodec({
            homeostatTransductionCovers: [{ coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey }],
        });

        await expect(createEndpoint().respond('deck=d1', coveringCodec.mediaType)).resolves.toMatchObject({ status: 406 });
    });

    it('answers 413 for more keys than maxBatchSize, counting the keys its covers add', async () => {
        const coveringCodec = new CNSHomeostatTransductionQueryCodec({
            homeostatTransductionCovers: [{ coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey }],
        });
        const endpoint = new CNSHomeostatTransductionEndpoint({ homeostatTransductionCodecs: [coveringCodec], maxBatchSize: 3, batchTransduceFn: () => Promise.resolve([]) });

        await expect(endpoint.respond('deck=d1;d2', undefined)).resolves.toEqual({ status: 413, headers: { 'content-type': 'text/plain', vary: 'accept' }, body: '4 keys, at most 3' });
        await expect(endpoint.respond('deck=d1', undefined)).resolves.toMatchObject({ status: 200 });
    });
});
