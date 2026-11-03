import { CNS, cnsNeuron } from '@cnstra/core';
import { createOIMEntityContentService, createOIMSingleSlotService, createOIMSlotCollectionService, OIMDB, OIMEffectService, OIM_SLICE_LENGTH_MS } from '@oimdb/core';
import { CNSHomeostatBatchTransducer, CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, CNSHomeostatTransductionEndpoint, CNSHomeostatTransductionFetch, CNSHomeostatTransductionQueryCodec, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { createCNSOIMDBHomeostatEnvironment } from '../index';
import { cnsAt, cnsSettleMicrotasks, createCNSHomeostatTestDeckServer } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';
import type { TCNSHomeostatTestCard as TCard, TCNSHomeostatTestDeck as TDeck } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

type TDeckCardList = { deckId: string; cards: TCard[] };

const settle = () => cnsSettleMicrotasks(undefined, 12);

const createApp = (options: { isOnline?: boolean; deckCardsStaleTimeMs?: number; isDeckAskedByRest?: boolean; isAskedThroughGetEndpoint?: boolean; isDeckCoveringItsCards?: boolean } = {}) => {
    let nowMs = 1_000_000;
    const db = new OIMDB({ getNowMs: () => nowMs });
    const deckServer = createCNSHomeostatTestDeckServer();
    const restRequests: string[] = [];
    const getURLs: string[] = [];
    const homeostatTransductionCodec = new CNSHomeostatTransductionQueryCodec({
        homeostatTransductionCovers: options.isDeckCoveringItsCards === true ? [{ coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey }] : [],
    });
    const syncEndpoint = new CNSHomeostatTransductionEndpoint({ homeostatTransductionCodecs: [homeostatTransductionCodec], batchTransduceFn: homeostatTransductionRequests => deckServer.batchTransduceFn(homeostatTransductionRequests, new AbortController().signal) });
    const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({
        url: '/sync',
        homeostatTransductionCodec,
        fetch: async (input, init) => {
            const url = String(input);
            getURLs.push(url);
            const { status, headers, body } = await syncEndpoint.respond(url.slice(url.indexOf('?') + 1), (init?.headers as Record<string, string> | undefined)?.accept);
            return new Response(body, { status, headers });
        },
    });
    const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
        batchTransduceFn: options.isAskedThroughGetEndpoint === true ? homeostatTransductionFetch.batchTransduceFn : deckServer.batchTransduceFn,
    });
    const deckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
        name: 'deck',
        staleTimeMs: 30_000,
        transduce: options.isDeckAskedByRest === true
            ? ([deckId]) => {
                restRequests.push(`GET /decks/${deckId}`);
                return Promise.resolve(cnsAt(deckServer.decks.filter(deck => deck.id === deckId), 0));
            }
            : homeostatBatchTransducer.transduceOf('deck', ([deck]) => deck as TDeck),
    });
    const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCard[]>({
        name: 'deckCards',
        staleTimeMs: options.deckCardsStaleTimeMs ?? 2_000,
        homeostatRefractoryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 10_000 },
        transduce: homeostatBatchTransducer.transduceOf('deckCards', cards => cards as TCard[]),
    });
    let decks: ReturnType<typeof createDeckStoreSlot>;
    let deckCardLists: ReturnType<typeof createDeckCardListStoreSlot>;
    const writtenDeckCardLists: string[] = [];
    const writer = cnsNeuron({})
        .dendrite({
            collateral: deckReceptor.axon.homeostasisRestored,
            response: ({ data }) => { decks.slotService.writeSlotContentByKey(decks, data.id, data); },
        })
        .dendrite({
            collateral: deckCardsReceptor.axon.homeostasisRestored,
            response: ({ key: [deckId], data }) => {
                writtenDeckCardLists.push(`${deckId}:${data.map(card => card.id).join(',')}`);
                const deckCardList = deckCardLists.slotService.getSlotByKey(deckCardLists, deckId).entity;
                if (JSON.stringify(deckCardList?.cards) === JSON.stringify(data)) return;
                deckCardLists.slotService.writeSlotContentByKey(deckCardLists, deckId, { deckId, cards: data });
            },
        });
    const cns = new CNS([
        deckReceptor.neuron,
        deckCardsReceptor.neuron,
        new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor, deckCardsReceptor] }).neuron,
        writer,
    ]);
    cns.addDrainListener(() => db.flush());
    const onlineService = createOIMSingleSlotService({ slotContentService: createOIMEntityContentService<{ isOnline: boolean }>() });
    const online = onlineService.createStoreSlot(db);
    onlineService.writeSingleSlotContent(online, { isOnline: options.isOnline ?? true });
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns, onlineSlot: onlineService.getSingleSlot(online) });
    const deckQueries = homeostatEnvironment.createComputedStoreAggregate(deckReceptor);
    const deckCardsReceptiveField = homeostatEnvironment.createReceptiveField(deckCardsReceptor, { selectKey: (deckId: string): [deckId: string] => [deckId] });
    const createDeckStoreSlot = () => createOIMSlotCollectionService({
        slotContentService: createOIMEntityContentService<TDeck, string>(),
    }).createStoreSlot(db);
    const createDeckCardListStoreSlot = () => createOIMSlotCollectionService({
        slotContentService: createOIMEntityContentService<TDeckCardList, string>(),
        slotSubscriptionListener: deckCardsReceptiveField.slotSubscriptionListener,
    }).createStoreSlot(db);
    decks = createDeckStoreSlot();
    deckCardLists = createDeckCardListStoreSlot();
    const render = (read: () => string) => {
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => { frames.push(read()); });
        return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const deckCardIdsOf = (deckId: string) => deckCardLists.slotService.getSlotByKey(deckCardLists, deckId).entity?.cards.map(card => card.id).join(',') ?? '-';
    const renderDecks = (deckIds: string[]) => render(() => deckIds.map(deckId => {
        const deckHomeostasis = deckQueries.getSlotByKey([deckId]).value;
        const deck = decks.slotService.getSlotByKey(decks, deckId).entity;
        return `${deckHomeostasis.status}:${deck?.title ?? '-'}:${deckCardIdsOf(deckId)}`;
    }).join(' '));
    const renderDeckCardList = (deckId: string) => render(() => deckCardIdsOf(deckId));
    const deckCardsCorrectionOf = (deckId: string) => homeostatEnvironment.homeostatCorrectionRepositoryOf(deckCardsReceptor)
        .peekHomeostatCorrectionState(homeostatEnvironment.homeostatEnvironmentOptions.keyHashFn([deckId]));
    const deckCardsStatusOf = (deckId: string) => deckCardsReceptiveField.homeostasisComputedStoreAggregate.getSlotByKey([deckId]).value.status;
    const advance = async (ms: number) => {
        nowMs += ms;
        await jest.advanceTimersByTimeAsync(ms);
        await settle();
    };
    const releaseHeldAnswers = async () => {
        for (const answer of deckServer.heldAnswers.splice(0)) answer();
        await advance(1);
    };
    return {
        deckServer, restRequests, getURLs, homeostatEnvironment, deckCardsReceptor, writtenDeckCardLists,
        setOnline: (isOnline: boolean) => {
            onlineService.writeSingleSlotContent(online, { isOnline });
            db.flush();
        },
        flush: () => db.flush(), renderDecks, renderDeckCardList, deckCardsStatusOf, deckCardsCorrectionOf, releaseHeldAnswers, advance,
    };
};

const screenDeckRequests = [
    { name: 'deck', key: ['d1'] },
    { name: 'deck', key: ['d2'] },
    { name: 'deckCards', key: ['d1'] },
    { name: 'deckCards', key: ['d2'] },
];

describe('one request for what an OIMDB screen reads', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('sends decks read through queries and card lists read through a receptive field in one batch, rendered once more with every answer', async () => {
        const app = createApp();

        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);

        expect(app.deckServer.sentBatches).toHaveLength(1);
        expect(app.deckServer.requestsOf(0)).toEqual(screenDeckRequests);
        expect(screen.frames).toEqual(['firing:-:- firing:-:-', 'restored:Spades:c1 restored:Hearts:c2']);
        screen.dispose();
    });

    it('asks the whole screen through one GET of the query codec and the endpoint, and writes every answer', async () => {
        const app = createApp({ isAskedThroughGetEndpoint: true });

        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);

        expect(app.getURLs).toEqual(['/sync?deck=d1;d2&deckCards=d1;d2']);
        expect(screen.frames).toEqual(['firing:-:- firing:-:-', 'restored:Spades:c1 restored:Hearts:c2']);
        screen.dispose();
    });

    it('leaves the card lists out of the GET when their decks are asked and still writes them', async () => {
        const app = createApp({ isAskedThroughGetEndpoint: true, isDeckCoveringItsCards: true });

        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);

        expect(app.getURLs).toEqual(['/sync?deck=d1;d2']);
        expect(screen.frames).toEqual(['firing:-:- firing:-:-', 'restored:Spades:c1 restored:Hearts:c2']);
        screen.dispose();
    });

    it('asks decks by REST per call and card lists of the screen through one route on the same screen', async () => {
        const app = createApp({ isDeckAskedByRest: true });

        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);

        expect(app.restRequests).toEqual(['GET /decks/d1', 'GET /decks/d2']);
        expect(app.deckServer.sentBatches.map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([[
            { name: 'deckCards', key: ['d1'] },
            { name: 'deckCards', key: ['d2'] },
        ]]);
        expect(cnsAt(screen.frames, screen.frames.length - 1)).toBe('restored:Spades:c1 restored:Hearts:c2');
        screen.dispose();
    });

    it('polls the card lists on the screen in one request per poll, leaves the decks alone, renders only a changed answer, and stops when the screen goes', async () => {
        const app = createApp();
        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);
        app.deckServer.cards.push({ id: 'c3', deck: 'd1', title: 'Three' });

        await app.advance(2_000 + OIM_SLICE_LENGTH_MS * 2);
        await app.advance(2_000 + OIM_SLICE_LENGTH_MS * 2);

        expect(app.deckServer.sentBatches.slice(1).map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([
            [{ name: 'deckCards', key: ['d1'] }, { name: 'deckCards', key: ['d2'] }],
            [{ name: 'deckCards', key: ['d1'] }, { name: 'deckCards', key: ['d2'] }],
        ]);
        expect(screen.frames.slice(2)).toEqual(['restored:Spades:c1,c3 restored:Hearts:c2']);
        screen.dispose();
        const sentBatchCount = app.deckServer.sentBatches.length;
        await app.advance(10_000);
        expect(app.deckServer.sentBatches).toHaveLength(sentBatchCount);
    });

    it('keeps the request when one card list leaves mid-flight, writes nothing for it, and aborts the request when the last one leaves', async () => {
        const app = createApp();
        app.deckServer.hang = true;
        const first = app.renderDeckCardList('d1');
        const second = app.renderDeckCardList('d2');
        await app.advance(1);
        const sentBatch = cnsAt(app.deckServer.sentBatches, 0);

        second.dispose();
        app.flush();
        await app.advance(1);
        expect(sentBatch.abortSignal.aborted).toBe(false);
        await app.releaseHeldAnswers();

        expect(app.writtenDeckCardLists).toEqual(['d1:c1']);
        expect(first.frames).toEqual(['-', 'c1']);
        first.dispose();
        await app.advance(1);
        const again = app.renderDeckCardList('d1');
        await app.advance(1);
        const refetch = cnsAt(app.deckServer.sentBatches, 1);
        again.dispose();
        app.flush();
        await app.advance(1);

        expect(refetch.abortSignal.aborted).toBe(true);
        await app.releaseHeldAnswers();
        expect(app.writtenDeckCardLists).toEqual(['d1:c1']);
    });

    it('writes the answer of a key invalidated while its batch is in flight as stale and sends the refresh in the next batch', async () => {
        const app = createApp();
        app.deckServer.hang = true;
        const screen = app.renderDeckCardList('d1');
        await app.advance(1);

        app.deckServer.cards.push({ id: 'c3', deck: 'd1', title: 'Three' });
        const refreshed = app.homeostatEnvironment.invalidate(app.deckCardsReceptor, ['d1']);
        await app.releaseHeldAnswers();
        await app.advance(1);

        expect(app.deckServer.sentBatches.map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([
            [{ name: 'deckCards', key: ['d1'] }],
            [{ name: 'deckCards', key: ['d1'] }],
        ]);
        expect(app.deckCardsCorrectionOf('d1')?.status).toBe(ECNSHomeostatCorrectionStatus.Stale);
        await app.releaseHeldAnswers();
        await expect(refreshed).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
        expect(cnsAt(screen.frames, screen.frames.length - 1)).toBe('c1,c3');
        screen.dispose();
    });

    it('fails only the card list whose row is an error and asks it again alone after the refractory delay', async () => {
        const app = createApp({ deckCardsStaleTimeMs: 60_000 });
        app.deckServer.missingCardsOf.add('d1');
        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);

        expect(app.deckCardsStatusOf('d1')).toBe(ECNSHomeostatCorrectionStatus.Failed);
        expect(cnsAt(screen.frames, screen.frames.length - 1)).toBe('restored:Spades:- restored:Hearts:c2');
        app.deckServer.missingCardsOf.clear();
        await app.advance(1_000 + OIM_SLICE_LENGTH_MS * 2);

        expect(app.deckServer.requestsOf(1)).toEqual([{ name: 'deckCards', key: ['d1'] }]);
        expect(cnsAt(screen.frames, screen.frames.length - 1)).toBe('restored:Spades:c1 restored:Hearts:c2');
        screen.dispose();
    });

    it('sends nothing while offline and one batch for the whole screen when the network comes back', async () => {
        const app = createApp({ isOnline: false });
        const screen = app.renderDecks(['d1', 'd2']);
        await app.advance(1);

        expect(app.deckServer.sentBatches).toEqual([]);
        expect(cnsAt(screen.frames, screen.frames.length - 1)).toBe('paused:-:- paused:-:-');
        app.setOnline(true);
        await app.advance(1);

        expect(app.deckServer.sentBatches.map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([screenDeckRequests]);
        expect(cnsAt(screen.frames, screen.frames.length - 1)).toBe('restored:Spades:c1 restored:Hearts:c2');
        screen.dispose();
    });
});
