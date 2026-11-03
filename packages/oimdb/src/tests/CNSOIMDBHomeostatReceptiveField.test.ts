import { CNS, cnsNeuron } from '@cnstra/core';
import {
    createOIMColumnGroup,
    createOIMEntityContentService,
    createOIMSlotCollectionService,
    OIMScalarKeyTreeWalk,
    OIMDB,
    OIMEffectService,
    OIMSlotTreeStoreService,
    OIM_SLICE_LENGTH_MS,
} from '@oimdb/core';
import type { TOIMEntitySlot, TOIMStoreKey } from '@oimdb/core';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { createCNSOIMDBHomeostatEnvironment } from '../index';
import { cnsAt, cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

type TDeck = { id: string; title: string };
type TCardsPage = { deckId: string; cursor: string | undefined; titles: string[] };
type TCardsPageKey = readonly [deckId: string, cursor: string | undefined, limit: number];

const createApp = (options: { staleTimeMs?: number } = {}) => {
    let nowMs = 1_000_000;
    const db = new OIMDB({ getNowMs: () => nowMs });
    const server = { titles: { d1: 'first' } as Record<string, string>, requested: [] as string[], failNext: 0, hang: false, answers: [] as (() => void)[], abortSignals: [] as AbortSignal[] };
    const deckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
        name: 'deck',
        staleTimeMs: options.staleTimeMs,
        transduce: ([deckId], abortSignal) => {
            server.requested.push(deckId);
            server.abortSignals.push(abortSignal);
            if (server.failNext > 0) {
                server.failNext--;
                return Promise.reject(new Error('HTTP 503'));
            }
            const answer = () => ({ id: deckId, title: server.titles[deckId] ?? `deck ${deckId}` });
            if (!server.hang) return Promise.resolve(answer());
            return new Promise((resolve, reject) => {
                server.answers.push(() => resolve(answer()));
                abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
            });
        },
    });
    const cardsPageReceptor = new CNSHomeostatReceptor<TCardsPageKey, TCardsPage>({
        name: 'cardsPage',
        transduce: ([deckId, cursor, limit]) => {
            server.requested.push(`${deckId}:${cursor}:${limit}`);
            return Promise.resolve({ deckId, cursor, titles: [`${deckId} card after ${cursor ?? 'start'}`] });
        },
    });
    let decks: ReturnType<typeof createDeckStoreSlot>;
    let cardsPages: ReturnType<typeof createCardsPageStoreSlot>;
    const writer = cnsNeuron({})
        .dendrite({
            collateral: deckReceptor.axon.homeostasisRestored,
            response: ({ data }) => { decks.slotService.writeSlotContentByKey(decks, data.id, data); },
        })
        .dendrite({
            collateral: cardsPageReceptor.axon.homeostasisRestored,
            response: ({ key, data }) => { cardsPages.slotService.writeSlotContentByKey(cardsPages, key, data); },
        });
    const cns = new CNS([
        deckReceptor.neuron,
        cardsPageReceptor.neuron,
        new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor, cardsPageReceptor] }).neuron,
        writer,
    ]);
    cns.addDrainListener(() => db.flush());
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
    const deckReceptiveField = homeostatEnvironment.createReceptiveField(deckReceptor, { selectKey: (deckId: string): [deckId: string] => [deckId] });
    const cardsPageReceptiveField = homeostatEnvironment.createReceptiveField(cardsPageReceptor, { selectKey: (pageKey: TCardsPageKey) => pageKey });
    const deckTitleColumnGroup = createOIMColumnGroup(['title']);
    const createDeckStoreSlot = () => createOIMSlotCollectionService({
        slotContentService: createOIMEntityContentService<TDeck, string>(),
        slotSubscriptionListener: deckReceptiveField.slotSubscriptionListener,
        columnGroups: [deckTitleColumnGroup],
    }).createStoreSlot(db);
    const createCardsPageStoreSlot = () => createOIMSlotCollectionService({
        slotContentService: createOIMEntityContentService<TCardsPage, TCardsPageKey>(),
        slotStoreService: new OIMSlotTreeStoreService<TOIMStoreKey | undefined, TOIMEntitySlot<TCardsPage, TCardsPageKey>>(OIMScalarKeyTreeWalk.INSTANCE),
        slotSubscriptionListener: cardsPageReceptiveField.slotSubscriptionListener,
    }).createStoreSlot(db);
    decks = createDeckStoreSlot();
    const mirroredDecks = createDeckStoreSlot();
    cardsPages = createCardsPageStoreSlot();
    const watchDeck = (deckId: string) => {
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            const deckHomeostasis = deckReceptiveField.homeostasisComputedStoreAggregate.getSlotByKey([deckId]).value;
            frames.push(`${deckHomeostasis.status}:${decks.slotService.getSlotByKey(decks, deckId).entity?.title ?? '-'}`);
        });
        return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const watchDeckData = (deckId: string) => {
        const titles: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            titles.push(decks.slotService.getSlotByKey(decks, deckId).entity?.title ?? '-');
        });
        return { titles, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const watchMirroredDeckData = (deckId: string) => {
        const titles: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            titles.push(mirroredDecks.slotService.getSlotByKey(mirroredDecks, deckId).entity?.title ?? '-');
        });
        return { titles, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const watchCardsPage = (pageKey: TCardsPageKey) => {
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            frames.push(cardsPages.slotService.getSlotByKey(cardsPages, pageKey).entity?.titles.join(',') ?? '-');
        });
        return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const watchDeckTitleColumn = (deckId: string) => {
        const titles: string[] = [];
        const deckSlot = decks.slotService.getSlotByKey(decks, deckId);
        const titleColumnSlot = deckSlot.getColumnGroupSlot(deckTitleColumnGroup);
        const effect = OIMEffectService.INSTANCE.createAndRunEffect(db, () => { titles.push(deckSlot.entity?.title ?? '-'); }, [titleColumnSlot]);
        return { titles, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const deckHomeostasisOf = (deckId: string) => deckReceptiveField.homeostasisComputedStoreAggregate.getSlotByKey([deckId]).value;
    const correctionOf = (deckId: string) =>
        homeostatEnvironment.homeostatCorrectionRepositoryOf(deckReceptor).peekHomeostatCorrectionState(homeostatEnvironment.homeostatEnvironmentOptions.keyHashFn([deckId]));
    const advance = async (ms: number) => {
        const advanceMs = ms + OIM_SLICE_LENGTH_MS * 2;
        nowMs += advanceMs;
        await jest.advanceTimersByTimeAsync(advanceMs);
        await settle();
    };
    return { db, server, deckReceptor, homeostatEnvironment, watchDeck, watchDeckData, watchMirroredDeckData, watchCardsPage, watchDeckTitleColumn, deckHomeostasisOf, correctionOf, advance };
};

const settle = () => cnsSettleMicrotasks(undefined, 12);
const last = (frames: readonly string[]) => cnsAt(frames, frames.length - 1);

type TCard = { id: string; title: string };
type TDeckCardIds = { deckId: string; cardIds: string[] };

const createDeckCardsScreenApp = (options: { isCardSlotDemanded?: (cardSlot: TOIMEntitySlot<TCard, string>) => boolean } = {}) => {
    const db = new OIMDB();
    const requested: string[] = [];
    const cardReceptor = new CNSHomeostatReceptor<[cardId: string], TCard>({
        name: 'card',
        transduce: ([cardId]) => {
            requested.push(`card:${cardId}`);
            return Promise.resolve({ id: cardId, title: `card ${cardId}` });
        },
    });
    const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCard[]>({
        name: 'deckCards',
        transduce: ([deckId]) => {
            requested.push(`deckCards:${deckId}`);
            return Promise.resolve(['c1', 'c2', 'c3'].map(cardId => ({ id: cardId, title: `${deckId} card ${cardId}` })));
        },
    });
    let cards: ReturnType<typeof createCardStoreSlot>;
    let deckCardIds: ReturnType<typeof createDeckCardIdsStoreSlot>;
    const writer = cnsNeuron({})
        .dendrite({
            collateral: cardReceptor.axon.homeostasisRestored,
            response: ({ data }) => { cards.slotService.writeSlotContentByKey(cards, data.id, data); },
        })
        .dendrite({
            collateral: deckCardsReceptor.axon.homeostasisRestored,
            response: ({ key: [deckId], data }) => {
                for (const card of data) cards.slotService.writeSlotContentByKey(cards, card.id, card);
                deckCardIds.slotService.writeSlotContentByKey(deckCardIds, deckId, { deckId, cardIds: data.map(card => card.id) });
            },
        });
    const cns = new CNS([
        cardReceptor.neuron,
        deckCardsReceptor.neuron,
        new CNSHomeostatReceptorCorrection({ homeostatReceptors: [cardReceptor, deckCardsReceptor] }).neuron,
        writer,
    ]);
    cns.addDrainListener(() => db.flush());
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
    const cardReceptiveField = homeostatEnvironment.createReceptiveField(cardReceptor, {
        selectKey: (cardId: string): [cardId: string] => [cardId],
        isSlotDemanded: options.isCardSlotDemanded,
    });
    const deckCardsReceptiveField = homeostatEnvironment.createReceptiveField(deckCardsReceptor, { selectKey: (deckId: string): [deckId: string] => [deckId] });
    const createCardStoreSlot = () => createOIMSlotCollectionService({
        slotContentService: createOIMEntityContentService<TCard, string>(),
        slotSubscriptionListener: cardReceptiveField.slotSubscriptionListener,
    }).createStoreSlot(db);
    const createDeckCardIdsStoreSlot = () => createOIMSlotCollectionService({
        slotContentService: createOIMEntityContentService<TDeckCardIds, string>(),
        slotSubscriptionListener: deckCardsReceptiveField.slotSubscriptionListener,
    }).createStoreSlot(db);
    cards = createCardStoreSlot();
    deckCardIds = createDeckCardIdsStoreSlot();
    const renderDeckCards = (deckId: string) => {
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            const cardIds = deckCardIds.slotService.getSlotByKey(deckCardIds, deckId).entity?.cardIds ?? [];
            frames.push(cardIds.map(cardId => cards.slotService.getSlotByKey(cards, cardId).entity?.title ?? '-').join(','));
        });
        return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    return { requested, renderDeckCards };
};

describe('a receptive field: a domain slot that is read asks its receptor', () => {
    it('asks once for a slot that got a reader and shows the answer', async () => {
        const app = createApp();
        const deck = app.watchDeckData('d1');
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        expect(deck.titles).toEqual(['-', 'first']);
        deck.dispose();
    });

    it('shares one request between readers of one slot', async () => {
        const app = createApp();
        const first = app.watchDeckData('d1');
        const second = app.watchDeckData('d1');
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        first.dispose();
        second.dispose();
    });

    it('does not ask for a slot whose reader left before the flush ended', async () => {
        const app = createApp();
        app.watchDeckData('d1').dispose();
        await settle();
        expect(app.server.requested).toEqual([]);
    });

    it('aborts the request when the last reader leaves before the answer, and lets the key go', async () => {
        const app = createApp();
        app.server.hang = true;
        const deck = app.watchDeckData('d1');
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        deck.dispose();
        await settle();
        app.db.flush();
        await settle();
        expect(cnsAt(app.server.abortSignals, 0).aborted).toBe(true);
        expect(app.correctionOf('d1')).toBeUndefined();
    });

    it('keeps the request while another slot of the key is read', async () => {
        const app = createApp();
        app.server.hang = true;
        const first = app.watchDeckData('d1');
        const second = app.watchMirroredDeckData('d1');
        await settle();
        first.dispose();
        await settle();
        app.db.flush();
        await settle();
        expect(cnsAt(app.server.abortSignals, 0).aborted).toBe(false);
        expect(app.server.requested).toEqual(['d1']);
        second.dispose();
    });

    it('gives the loading and the error of a read slot through the field, with no request of its own', async () => {
        const app = createApp();
        app.server.hang = true;
        const deck = app.watchDeckData('d1');
        await settle();
        expect(app.deckHomeostasisOf('d1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing });
        expect(app.server.requested).toEqual(['d1']);
        deck.dispose();
        const failing = createApp();
        failing.server.failNext = 1;
        const failingDeck = failing.watchDeckData('d1');
        await settle();
        expect(failing.deckHomeostasisOf('d1')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Failed, error: new Error('HTTP 503') });
        expect(failing.server.requested).toEqual(['d1']);
        failingDeck.dispose();
    });

    it('keeps the request when a reader leaves and another comes in the same tick', async () => {
        const app = createApp();
        app.server.hang = true;
        const first = app.watchDeckData('d1');
        await settle();
        app.db.flush();
        first.dispose();
        const second = app.watchDeckData('d1');
        await settle();
        app.db.flush();
        await settle();
        expect(cnsAt(app.server.abortSignals, 0).aborted).toBe(false);
        expect(app.server.requested).toEqual(['d1']);
        cnsAt(app.server.answers, 0)();
        await settle();
        expect(last(second.titles)).toBe('first');
        second.dispose();
    });

    it('asks for the entity of a read column', async () => {
        const app = createApp();
        const deck = app.watchDeckTitleColumn('d1');
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        expect(last(deck.titles)).toBe('first');
        deck.dispose();
    });

    it('refetches a slot that stays on screen after its stale time', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const app = createApp({ staleTimeMs: 5_000 });
            const deck = app.watchDeckData('d1');
            await settle();
            app.server.titles.d1 = 'later';
            await app.advance(5_000);
            expect(app.server.requested).toEqual(['d1', 'd1']);
            expect(last(deck.titles)).toBe('later');
            deck.dispose();
        } finally {
            jest.useRealTimers();
        }
    });

    it('refreshes a slot on screen on invalidate', async () => {
        const app = createApp();
        const deck = app.watchDeckData('d1');
        await settle();
        app.server.titles.d1 = 'saved';
        const refreshed = app.homeostatEnvironment.invalidate(app.deckReceptor, ['d1']);
        await settle();
        await expect(refreshed).resolves.toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
        expect(last(deck.titles)).toBe('saved');
        deck.dispose();
    });

    it('shares the request with a query of the same key', async () => {
        const app = createApp();
        app.server.hang = true;
        const query = app.watchDeck('d1');
        const deck = app.watchDeckData('d1');
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        cnsAt(app.server.answers, 0)();
        await settle();
        expect(last(query.frames)).toBe('restored:first');
        query.dispose();
        deck.dispose();
    });

    it('asks a page of a composite key, the first page with an undefined cursor', async () => {
        const app = createApp();
        const firstPage = app.watchCardsPage(['d1', undefined, 20]);
        const nextPage = app.watchCardsPage(['d1', 'c20', 20]);
        await settle();
        expect(app.server.requested).toEqual(['d1:undefined:20', 'd1:c20:20']);
        expect(last(firstPage.frames)).toBe('d1 card after start');
        expect(last(nextPage.frames)).toBe('d1 card after c20');
        firstPage.dispose();
        nextPage.dispose();
    });

    it('asks for the other slots of a flush when selectKey throws on one of them', async () => {
        const app = createApp();
        const errors: unknown[] = [];
        const queueMicrotaskSpy = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(run => {
            void Promise.resolve().then(() => {
                try {
                    run();
                } catch (error) {
                    errors.push(error);
                }
            });
        });
        try {
            const field = app.homeostatEnvironment.createReceptiveField(app.deckReceptor, {
                selectKey: (deckId: string): [deckId: string] => {
                    if (deckId === 'bad') throw new Error('bad deck id');
                    return [deckId];
                },
            });
            const someDecks = createOIMSlotCollectionService({
                slotContentService: createOIMEntityContentService<TDeck, string>(),
                slotSubscriptionListener: field.slotSubscriptionListener,
            }).createStoreSlot(app.db);
            const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(app.db, () => {
                void someDecks.slotService.getSlotByKey(someDecks, 'bad').entity;
                void someDecks.slotService.getSlotByKey(someDecks, 'd2').entity;
            });
            await settle();
            expect(errors).toEqual([new Error('bad deck id')]);
            expect(app.server.requested).toEqual(['d2']);
            OIMEffectService.INSTANCE.disposeEffect(effect);
        } finally {
            queueMicrotaskSpy.mockRestore();
        }
    });

    it('reports a slot of another db after the flush and leaves that slot intact', async () => {
        const app = createApp();
        const otherDb = new OIMDB();
        const otherDecks = createOIMSlotCollectionService({
            slotContentService: createOIMEntityContentService<TDeck, string>(),
            slotSubscriptionListener: app.homeostatEnvironment.createReceptiveField(app.deckReceptor, { selectKey: (deckId: string): [deckId: string] => [deckId] }).slotSubscriptionListener,
        }).createStoreSlot(otherDb);
        const errors: unknown[] = [];
        const queueMicrotaskSpy = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(run => {
            void Promise.resolve().then(() => {
                try {
                    run();
                } catch (error) {
                    errors.push(error);
                }
            });
        });
        try {
            const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(otherDb, () => { void otherDecks.slotService.getSlotByKey(otherDecks, 'd1').entity; });
            await settle();
            expect(errors).toEqual([new Error('CNSOIMDBHomeostatReceptiveField: a slot of another db is read; create a receptive field per environment')]);
            const otherSlot = otherDecks.slotService.getSlotByKey(otherDecks, 'd1');
            expect(otherSlot.effects).toHaveLength(1);
            OIMEffectService.INSTANCE.disposeEffect(effect);
            expect(otherSlot.effects ?? []).toHaveLength(0);
            otherDb.flush();
            expect(otherSlot.holdCount).toBe(0);
            expect(app.server.requested).toEqual([]);
        } finally {
            queueMicrotaskSpy.mockRestore();
        }
    });

    it('drops its key holds when the environment is disposed and asks nothing for a slot read after it', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        const disposeEffect = jest.spyOn(OIMEffectService.INSTANCE, 'disposeEffect');
        const createSourceTrackingEffect = jest.spyOn(OIMEffectService.INSTANCE, 'createSourceTrackingEffect');
        try {
            const app = createApp({ staleTimeMs: 5_000 });
            app.server.hang = true;
            const deck = app.watchDeckData('d1');
            await settle();
            expect(app.server.requested).toEqual(['d1']);
            disposeEffect.mockClear();
            createSourceTrackingEffect.mockClear();
            app.homeostatEnvironment.dispose();
            expect(cnsAt(app.server.abortSignals, 0).aborted).toBe(true);
            expect(disposeEffect).toHaveBeenCalledTimes(1);
            const otherDeck = app.watchDeckData('d2');
            await app.advance(10_000);
            expect(createSourceTrackingEffect).toHaveBeenCalledTimes(1);
            expect(app.server.requested).toEqual(['d1']);
            deck.dispose();
            otherDeck.dispose();
        } finally {
            disposeEffect.mockRestore();
            createSourceTrackingEffect.mockRestore();
            jest.useRealTimers();
        }
    });

    it('asks nothing for the cards a bucket answer wrote when a read card slot with content is not demand', async () => {
        const app = createDeckCardsScreenApp({ isCardSlotDemanded: cardSlot => cardSlot.entity === undefined });
        const screen = app.renderDeckCards('d1');
        await settle();
        expect(app.requested).toEqual(['deckCards:d1']);
        expect(last(screen.frames)).toBe('d1 card c1,d1 card c2,d1 card c3');
        screen.dispose();
    });

    it('asks each card a bucket answer wrote when every read slot is demand: N+1 requests', async () => {
        const app = createDeckCardsScreenApp();
        const screen = app.renderDeckCards('d1');
        await settle();
        expect([...app.requested].sort()).toEqual(['card:c1', 'card:c2', 'card:c3', 'deckCards:d1']);
        expect(last(screen.frames)).toBe('card c1,card c2,card c3');
        screen.dispose();
    });
});
