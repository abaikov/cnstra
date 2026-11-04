import { collateral, neuron } from '@cnstra/core';
import { assembleCNSHomeostatSchema, CNSHomeostatReceptor, defineCNSHomeostatModel, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import type {
    ICNSHomeostatModelBinding,
    ICNSHomeostatModelHandles,
    TCNSHomeostatModelHandle,
    TCNSHomeostatModelKey,
    TCNSHomeostatNeuronDependencies,
    TCNSHomeostatSchemaOptions,
} from '@cnstra/sync';

export type TCNSHomeostatModelConformanceCard = { id: string; title: string; version: number };

export type TCNSHomeostatModelConformanceCardsPageSummary = { total: number; nextCursor: string | undefined };

export type TCNSHomeostatModelConformanceWatch = {
    frames: string[];
    dispose: () => void;
};

export type TCNSHomeostatModelConformanceEngine<THandles extends ICNSHomeostatModelHandles> = {
    createBinding(): ICNSHomeostatModelBinding<THandles>;
    watch(read: () => string): TCNSHomeostatModelConformanceWatch;
    cardOf(
        cards: TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TCNSHomeostatModelConformanceCard }>,
        cardId: string
    ): TCNSHomeostatModelConformanceCard | undefined;
    writeCard(
        cards: TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TCNSHomeostatModelConformanceCard }>,
        card: TCNSHomeostatModelConformanceCard
    ): void;
    cardsOf(
        cardsBucket: TCNSHomeostatModelHandle<THandles, 'bucketCollection', { readonly entity: TCNSHomeostatModelConformanceCard }>,
        key: TCNSHomeostatModelKey
    ): readonly (TCNSHomeostatModelConformanceCard | undefined)[];
    cardsPageSummaryOf(
        cardsPageSummary: TCNSHomeostatModelHandle<THandles, 'summaryCollection', { readonly summary: TCNSHomeostatModelConformanceCardsPageSummary }>,
        key: TCNSHomeostatModelKey
    ): TCNSHomeostatModelConformanceCardsPageSummary | undefined;
    peekCard(
        cards: TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TCNSHomeostatModelConformanceCard }>,
        cardId: string
    ): TCNSHomeostatModelConformanceCard | undefined;
    peekCards(
        cardsBucket: TCNSHomeostatModelHandle<THandles, 'bucketCollection', { readonly entity: TCNSHomeostatModelConformanceCard }>,
        key: TCNSHomeostatModelKey
    ): readonly (TCNSHomeostatModelConformanceCard | undefined)[] | undefined;
    peekCardsPageSummary(
        cardsPageSummary: TCNSHomeostatModelHandle<THandles, 'summaryCollection', { readonly summary: TCNSHomeostatModelConformanceCardsPageSummary }>,
        key: TCNSHomeostatModelKey
    ): TCNSHomeostatModelConformanceCardsPageSummary | undefined;
    homeostasisStatusOf(
        homeostasis: TCNSHomeostatModelHandle<THandles, 'homeostasis', { readonly key: [deckId: string] }>,
        key: [deckId: string]
    ): string;
    settle(): Promise<void>;
    advance(ms: number): Promise<void>;
};

type TCard = TCNSHomeostatModelConformanceCard;

type TCardsPage = { rows: TCard[]; total: number; nextCursor: string | undefined };

type TCNSHomeostatModelConformanceDoor = 'createNeuron' | 'homeostatDendrites';

type TCNSHomeostatModelConformanceKeepAfterIdleMs = { readonly cards?: number; readonly deckCards?: number; readonly cardsPage?: number };

const deckAxon = { cardsChanged: collateral<{ insertedCardIds: string[]; changedCardIds: string[] }>() };

const deckUiAxon = {
    cardRenameRequested: collateral<{ cardId: string; title: string }>(),
    deckCardsRefreshRequested: collateral<{ deckId: string }>(),
};

const last = (frames: readonly string[]): string => {
    const frame = frames[frames.length - 1];
    if (frame === undefined) throw new Error('nothing was rendered');
    return frame;
};

const createServer = () => {
    const server = {
        requested: [] as string[],
        cards: new Map<string, TCard>([
            ['c1', { id: 'c1', title: 'Ace', version: 1 }],
            ['c2', { id: 'c2', title: 'Two', version: 1 }],
            ['c9', { id: 'c9', title: 'Nine', version: 1 }],
        ]),
        deckCardIds: ['c1', 'c2'],
        cardOf: (cardId: string): TCard => {
            const card = server.cards.get(cardId);
            if (card === undefined) throw new Error(`no card ${cardId}`);
            return { ...card };
        },
    };
    return server;
};

const useFakeTimers = () => jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });

const createDeckModelDefinition = (server: ReturnType<typeof createServer>, keepAfterIdleMs: TCNSHomeostatModelConformanceKeepAfterIdleMs = {}) => {
    const cardReceptor = new CNSHomeostatReceptor<[cardId: string], TCard>({
        name: 'card',
        transduce: ([cardId]) => {
            server.requested.push(`card:${cardId}`);
            return Promise.resolve(server.cardOf(cardId));
        },
    });
    const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCard[]>({
        name: 'deckCards',
        transduce: ([deckId]) => {
            server.requested.push(`deckCards:${deckId}`);
            return Promise.resolve(server.deckCardIds.map(server.cardOf));
        },
    });
    const cardsPageReceptor = new CNSHomeostatReceptor<[deckId: string, cursor: string | undefined], TCardsPage>({
        name: 'cardsPage',
        transduce: ([deckId, cursor]) => {
            server.requested.push(`cardsPage:${deckId}:${cursor ?? 'start'}`);
            const rows = server.deckCardIds.map(server.cardOf);
            return Promise.resolve({ rows, total: rows.length, nextCursor: rows[rows.length - 1]?.id });
        },
    });
    const deckModelDefinition = defineCNSHomeostatModel(deckAxon)
        .collection('cards', {
            idOf: (card: TCard) => card.id,
            isNewer: (incoming, current) => incoming.version >= current.version,
            keepAfterIdleMs: keepAfterIdleMs.cards,
            homeostatReceptor: { homeostatReceptor: cardReceptor, keyOf: (cardId): [cardId: string] => [cardId] },
        })
        .homeostatReceptor('deckCards', {
            homeostatReceptor: deckCardsReceptor,
            bucketsOf: cards => ({ cards }),
            keepAfterIdleMs: keepAfterIdleMs.deckCards,
            afterWrite: ({ insertedEntities, changedEntities }, axon) => insertedEntities.cards.length + changedEntities.cards.length === 0
                ? undefined
                : axon.cardsChanged.createSignal({
                    insertedCardIds: insertedEntities.cards.map(card => card.id),
                    changedCardIds: changedEntities.cards.map(card => card.id),
                }),
        })
        .homeostatReceptor('cardsPage', {
            homeostatReceptor: cardsPageReceptor,
            bucketsOf: page => ({ cards: page.rows }),
            summaryOf: (page): TCNSHomeostatModelConformanceCardsPageSummary => ({ total: page.total, nextCursor: page.nextCursor }),
            keepAfterIdleMs: keepAfterIdleMs.cardsPage,
        });
    return { deckModelDefinition, cardReceptor, deckCardsReceptor, cardsPageReceptor };
};

export function cnsHomeostatModelConformance<THandles extends ICNSHomeostatModelHandles>(
    bindingName: string,
    createEngine: () => TCNSHomeostatModelConformanceEngine<THandles>
): void {
    const createWorld = (door: TCNSHomeostatModelConformanceDoor = 'createNeuron', keepAfterIdleMs: TCNSHomeostatModelConformanceKeepAfterIdleMs = {}) => {
        const engine = createEngine();
        const server = createServer();
        const { deckModelDefinition, cardReceptor, deckCardsReceptor, cardsPageReceptor } = createDeckModelDefinition(server, keepAfterIdleMs);
        type TDeckNeuronDependencies = TCNSHomeostatNeuronDependencies<{ deckModel: typeof deckModelDefinition }, THandles>;
        const audits: string[] = [];
        const createDeckNeuron = ({ deckModel, homeostatEnvironment }: TDeckNeuronDependencies) => (door === 'createNeuron' ? deckModel.createNeuron() : neuron(deckAxon).dendrite(deckModel.homeostatDendrites))
            .dendrite({
                collateral: deckUiAxon.cardRenameRequested,
                response: ({ cardId, title }, axon) => {
                    const version = engine.cardOf(deckModel.collections.cards, cardId)?.version ?? 0;
                    engine.writeCard(deckModel.collections.cards, { id: cardId, title, version: version + 1 });
                    return axon.cardsChanged.createSignal({ insertedCardIds: [], changedCardIds: [cardId] });
                },
            })
            .dendrite({
                collateral: deckUiAxon.deckCardsRefreshRequested,
                response: ({ deckId }) => { void homeostatEnvironment.invalidate(deckCardsReceptor, [deckId]); },
            });
        const createDeckUiNeuron = () => neuron(deckUiAxon);
        const createAuditNeuron = () => neuron({}).dendrite({
            collateral: deckAxon.cardsChanged,
            response: ({ insertedCardIds, changedCardIds }) => { audits.push(`${insertedCardIds.join(',')}|${changedCardIds.join(',')}`); },
        });
        const schema = assembleCNSHomeostatSchema<
            THandles,
            { deckModel: typeof deckModelDefinition },
            { deckNeuron: ReturnType<typeof createDeckNeuron>; deckUiNeuron: ReturnType<typeof createDeckUiNeuron>; auditNeuron: ReturnType<typeof createAuditNeuron> }
        >(engine.createBinding(), {
            homeostatModels: { deckModel: deckModelDefinition },
            neuronFactories: { deckNeuron: createDeckNeuron, deckUiNeuron: createDeckUiNeuron, auditNeuron: createAuditNeuron },
        });
        const deckModel = schema.deckModel;
        return {
            engine,
            server,
            schema,
            audits,
            cardReceptor,
            deckCardsReceptor,
            cardsPageReceptor,
            renderDeckCards: (deckId: string) => engine.watch(() => engine.cardsOf(deckModel.buckets.deckCards.cards, [deckId]).map(card => card?.title ?? '-').join(',')),
            renderCardsPage: (deckId: string) => engine.watch(() => {
                const titles = engine.cardsOf(deckModel.buckets.cardsPage.cards, [deckId, undefined]).map(card => card?.title ?? '-').join(',');
                const cardsPageSummary = engine.cardsPageSummaryOf(deckModel.summaries.cardsPage, [deckId, undefined]);
                return `${titles}|${cardsPageSummary?.total ?? '-'}|${cardsPageSummary?.nextCursor ?? '-'}`;
            }),
            renderCardsPageSummary: (deckId: string) => engine.watch(() => `${engine.cardsPageSummaryOf(deckModel.summaries.cardsPage, [deckId, undefined])?.total ?? '-'}`),
            renderCard: (cardId: string) => engine.watch(() => engine.cardOf(deckModel.collections.cards, cardId)?.title ?? '-'),
            peekCardTitle: (cardId: string) => engine.peekCard(deckModel.collections.cards, cardId)?.title,
            peekDeckCardTitles: (deckId: string) => engine.peekCards(deckModel.buckets.deckCards.cards, [deckId])?.map(card => card?.title ?? '-').join(','),
            peekCardsPageTitles: (deckId: string) => engine.peekCards(deckModel.buckets.cardsPage.cards, [deckId, undefined])?.map(card => card?.title ?? '-').join(','),
            peekCardsPageTotal: (deckId: string) => engine.peekCardsPageSummary(deckModel.summaries.cardsPage, [deckId, undefined])?.total,
            deckCardsStatusOf: (deckId: string) => engine.homeostasisStatusOf(deckModel.homeostasis.deckCards, [deckId]),
            cardStatusOf: (cardId: string) => engine.homeostasisStatusOf(deckModel.homeostasis.cards, [cardId]),
        };
    };

    describe(`homeostat models on ${bindingName}: the domain neuron owns its synced model`, () => {
        it('reads a deck screen through one bucket request, with no request per card it wrote', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['deckCards:d1']);
            expect(last(screen.frames)).toBe('Ace,Two');
            expect(world.deckCardsStatusOf('d1')).toBe(ECNSHomeostatCorrectionStatus.Restored);
            screen.dispose();
        });

        it('asks the card receptor for a card read on its own', async () => {
            const world = createWorld();
            const card = world.renderCard('c9');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['card:c9']);
            expect(last(card.frames)).toBe('Nine');
            card.dispose();
        });

        it('invalidates every held key of every receptor of a model with one call', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            const card = world.renderCard('c9');
            await world.engine.settle();
            world.server.requested.length = 0;
            await world.schema.deckModel.invalidate();
            await world.engine.settle();
            expect([...world.server.requested].sort()).toEqual(['card:c9', 'deckCards:d1']);
            screen.dispose();
            card.dispose();
        });

        it('shows the loading and the failure of an entity read through its collection receptor in homeostasis under the collection name', async () => {
            const world = createWorld();
            const card = world.renderCard('c9');
            const missingCard = world.renderCard('c404');
            await world.engine.settle();
            expect(last(card.frames)).toBe('Nine');
            expect(world.cardStatusOf('c9')).toBe(ECNSHomeostatCorrectionStatus.Restored);
            expect(last(missingCard.frames)).toBe('-');
            expect(world.cardStatusOf('c404')).toBe(ECNSHomeostatCorrectionStatus.Failed);
            card.dispose();
            missingCard.dispose();
        });

        it('runs a mutation dendrite of the domain neuron that has nothing to do with sync, beside the sync dendrites', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            await world.schema.cns.stimulate(deckUiAxon.cardRenameRequested.createSignal({ cardId: 'c1', title: 'Ace of spades' })).waitUntilComplete();
            await world.engine.settle();
            expect(last(screen.frames)).toBe('Ace of spades,Two');
            expect(world.audits).toEqual(['c1,c2|', '|c1']);
            screen.dispose();
        });

        it('builds the same neuron from neuron(axon).dendrite(homeostatDendrites)', async () => {
            const world = createWorld('homeostatDendrites');
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            await world.schema.cns.stimulate(deckUiAxon.cardRenameRequested.createSignal({ cardId: 'c2', title: 'Two of hearts' })).waitUntilComplete();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['deckCards:d1']);
            expect(last(screen.frames)).toBe('Ace,Two of hearts');
            expect(world.audits).toEqual(['c1,c2|', '|c2']);
            screen.dispose();
        });

        it('gives every neuron factory the homeostat environment, so a domain dendrite invalidates a key of its model', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            world.server.deckCardIds = ['c1', 'c9'];
            await world.schema.cns.stimulate(deckUiAxon.deckCardsRefreshRequested.createSignal({ deckId: 'd1' })).waitUntilComplete();
            await world.engine.settle();
            expect(world.server.requested).toEqual(['deckCards:d1', 'deckCards:d1']);
            expect(last(screen.frames)).toBe('Ace,Nine');
            screen.dispose();
        });

        it('creates a bucket collection only for a collection the receptor answers into buckets', async () => {
            const engine = createEngine();
            const binding = engine.createBinding();
            const createBucketCollection = jest.spyOn(binding, 'createBucketCollection');
            const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCard[]>({
                name: 'deckCards',
                transduce: () => Promise.resolve([{ id: 'c1', title: 'Ace', version: 1 }]),
            });
            const deckModelDefinition = defineCNSHomeostatModel(deckAxon)
                .collection('decks', { idOf: (deck: { id: string }) => deck.id })
                .collection('cards', { idOf: (card: TCard) => card.id })
                .homeostatReceptor('deckCards', { homeostatReceptor: deckCardsReceptor, bucketsOf: cards => ({ cards }) });
            const schema = assembleCNSHomeostatSchema<THandles, { deckModel: typeof deckModelDefinition }>(binding, {
                homeostatModels: { deckModel: deckModelDefinition },
                neuronFactories: { deckNeuron: ({ deckModel }) => deckModel.createNeuron() },
            });
            const screen = engine.watch(() => engine.cardsOf(schema.deckModel.buckets.deckCards.cards, ['d1']).map(card => card?.title ?? '-').join(','));
            await engine.settle();
            expect(last(screen.frames)).toBe('Ace');
            expect(createBucketCollection).toHaveBeenCalledTimes(1);
            screen.dispose();
        });

        it('splits a page answer into a bucket of its rows and a value of the rest', async () => {
            const world = createWorld();
            const page = world.renderCardsPage('d1');
            await world.engine.settle();
            expect(world.server.requested).toEqual(['cardsPage:d1:start']);
            expect(last(page.frames)).toBe('Ace,Two|2|c2');
            page.dispose();
        });

        it('wakes nobody and signals nothing for an answer equal to what the model holds', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            const page = world.renderCardsPage('d1');
            await world.engine.settle();
            const card = world.renderCard('c1');
            await world.engine.settle();
            const screenFrameCount = screen.frames.length;
            const pageFrameCount = page.frames.length;
            const cardFrameCount = card.frames.length;
            await world.schema.homeostatEnvironment.invalidate(world.deckCardsReceptor, ['d1']);
            await world.schema.homeostatEnvironment.invalidate(world.cardsPageReceptor, ['d1', undefined]);
            await world.engine.settle();
            expect(world.server.requested).toEqual(['deckCards:d1', 'cardsPage:d1:start', 'deckCards:d1', 'cardsPage:d1:start']);
            expect(screen.frames).toHaveLength(screenFrameCount);
            expect(page.frames).toHaveLength(pageFrameCount);
            expect(card.frames).toHaveLength(cardFrameCount);
            expect(world.audits).toEqual(['c1,c2|']);
            screen.dispose();
            page.dispose();
            card.dispose();
        });

        it('skips the write of an entity isNewer finds older than the one held, and writes a newer one', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            world.server.cards.set('c1', { id: 'c1', title: 'Stale ace', version: 0 });
            await world.schema.homeostatEnvironment.invalidate(world.deckCardsReceptor, ['d1']);
            await world.engine.settle();
            expect(last(screen.frames)).toBe('Ace,Two');
            expect(world.audits).toEqual(['c1,c2|']);
            world.server.cards.set('c1', { id: 'c1', title: 'New ace', version: 2 });
            await world.schema.homeostatEnvironment.invalidate(world.deckCardsReceptor, ['d1']);
            await world.engine.settle();
            expect(last(screen.frames)).toBe('New ace,Two');
            expect(world.audits).toEqual(['c1,c2|', '|c1']);
            screen.dispose();
        });

        it('lets afterWrite return a signal of the model axon with the entities the answer inserted and changed', async () => {
            const world = createWorld();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            world.server.cards.set('c2', { id: 'c2', title: 'Deuce', version: 1 });
            await world.schema.homeostatEnvironment.invalidate(world.deckCardsReceptor, ['d1']);
            await world.engine.settle();
            expect(world.audits).toEqual(['c1,c2|', '|c2']);
            expect(last(screen.frames)).toBe('Ace,Deuce');
            screen.dispose();
        });

        it('runs afterWrite for a summary-only answer that changed the summary, and not for one equal to it', async () => {
            const engine = createEngine();
            const server = { total: 2 };
            const afterWrites: string[] = [];
            const deckSummaryReceptor = new CNSHomeostatReceptor<[deckId: string], TCNSHomeostatModelConformanceCardsPageSummary>({
                name: 'deckSummary',
                transduce: () => Promise.resolve({ total: server.total, nextCursor: undefined }),
            });
            const deckModelDefinition = defineCNSHomeostatModel(deckAxon)
                .homeostatReceptor('deckSummary', {
                    homeostatReceptor: deckSummaryReceptor,
                    summaryOf: (deckSummary): TCNSHomeostatModelConformanceCardsPageSummary => deckSummary,
                    afterWrite: ({ data, isBucketChanged, isSummaryChanged }) => {
                        afterWrites.push(`${data.total}|${String(isBucketChanged)}|${String(isSummaryChanged)}`);
                        return undefined;
                    },
                });
            const schema = assembleCNSHomeostatSchema<THandles, { deckModel: typeof deckModelDefinition }>(engine.createBinding(), {
                homeostatModels: { deckModel: deckModelDefinition },
                neuronFactories: { deckNeuron: ({ deckModel }) => deckModel.createNeuron() },
            });
            const screen = engine.watch(() => `${engine.cardsPageSummaryOf(schema.deckModel.summaries.deckSummary, ['d1'])?.total ?? '-'}`);
            await engine.settle();
            expect(afterWrites).toEqual(['2|false|true']);
            await schema.homeostatEnvironment.invalidate(deckSummaryReceptor, ['d1']);
            await engine.settle();
            expect(afterWrites).toEqual(['2|false|true']);
            server.total = 3;
            await schema.homeostatEnvironment.invalidate(deckSummaryReceptor, ['d1']);
            await engine.settle();
            expect(afterWrites).toEqual(['2|false|true', '3|false|true']);
            expect(last(screen.frames)).toBe('3');
            screen.dispose();
        });

        it('counts a first empty bucket as no change and a first filled one as a change, the same on every binding', async () => {
            const engine = createEngine();
            const server: { cards: TCNSHomeostatModelConformanceCard[] } = { cards: [] };
            const afterWrites: string[] = [];
            const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCNSHomeostatModelConformanceCard[]>({
                name: 'emptyDeckCards',
                transduce: () => Promise.resolve(server.cards),
            });
            const deckModelDefinition = defineCNSHomeostatModel(deckAxon)
                .collection('cards', { idOf: (card: TCNSHomeostatModelConformanceCard) => card.id })
                .homeostatReceptor('emptyDeckCards', {
                    homeostatReceptor: deckCardsReceptor,
                    bucketsOf: cards => ({ cards }),
                    afterWrite: ({ isBucketChanged }) => {
                        afterWrites.push(String(isBucketChanged));
                        return undefined;
                    },
                });
            const schema = assembleCNSHomeostatSchema<THandles, { deckModel: typeof deckModelDefinition }>(engine.createBinding(), {
                homeostatModels: { deckModel: deckModelDefinition },
                neuronFactories: { deckNeuron: ({ deckModel }) => deckModel.createNeuron() },
            });
            const screen = engine.watch(() => engine.cardsOf(schema.deckModel.buckets.emptyDeckCards.cards, ['d1']).map(card => card?.title ?? '-').join(','));
            await engine.settle();
            expect(afterWrites).toEqual([]);
            server.cards = [{ id: 'c1', title: 'Ace', version: 1 }];
            await schema.homeostatEnvironment.invalidate(deckCardsReceptor, ['d1']);
            await engine.settle();
            expect(afterWrites).toEqual(['true']);
            expect(last(screen.frames)).toBe('Ace');
            screen.dispose();
        });

        it('passes afterWrite as inserted an entity the model held none of, and leaves out one it held unchanged', async () => {
            const world = createWorld();
            const card = world.renderCard('c1');
            await world.engine.settle();
            const screen = world.renderDeckCards('d1');
            await world.engine.settle();
            expect(world.audits).toEqual(['c2|']);
            card.dispose();
            screen.dispose();
        });

        it('exposes the neurons the schema adds beside the domain neurons', () => {
            const world = createWorld();
            expect(Object.keys(world.schema.neurons)).toEqual(['deckNeuron', 'deckUiNeuron', 'auditNeuron']);
            expect(world.schema.neurons.deckNeuron.dendrites).toEqual(expect.arrayContaining([...world.schema.deckModel.homeostatDendrites]));
            const homeostatNeurons = world.schema.homeostatNeurons;
            expect(homeostatNeurons.homeostatReceptors).toHaveLength(3);
            expect(homeostatNeurons.homeostatReceptors[0]).toBe(world.cardReceptor.neuron);
            expect(homeostatNeurons.homeostatReceptors[1]).toBe(world.deckCardsReceptor.neuron);
            expect(homeostatNeurons.homeostatReceptors[2]).toBe(world.cardsPageReceptor.neuron);
            expect(homeostatNeurons.homeostatReceptorCorrection.dendrites.map(dendrite => dendrite.collateral)).toContain(world.cardsPageReceptor.axon.homeostasisRestored);
        });

        it('drops an entity nobody reads keepAfterIdleMs after its last reader left, and asks for it again when it is read again', async () => {
            useFakeTimers();
            try {
                const world = createWorld('createNeuron', { cards: 10_000 });
                const card = world.renderCard('c9');
                await world.engine.settle();
                card.dispose();
                await world.engine.settle();
                await world.engine.advance(5_000);
                expect(world.peekCardTitle('c9')).toBe('Nine');
                await world.engine.advance(10_000);
                expect(world.peekCardTitle('c9')).toBeUndefined();
                const again = world.renderCard('c9');
                await world.engine.settle();
                expect(world.server.requested).toEqual(['card:c9', 'card:c9']);
                expect(last(again.frames)).toBe('Nine');
                again.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('keeps the members of a bucket while the bucket stays, and drops them with it', async () => {
            useFakeTimers();
            try {
                const world = createWorld('createNeuron', { cards: 10_000, deckCards: 30_000 });
                const screen = world.renderDeckCards('d1');
                await world.engine.settle();
                await world.engine.advance(40_000);
                expect(world.peekDeckCardTitles('d1')).toBe('Ace,Two');
                screen.dispose();
                await world.engine.settle();
                await world.engine.advance(20_000);
                expect(world.peekDeckCardTitles('d1')).toBe('Ace,Two');
                expect(world.peekCardTitle('c1')).toBe('Ace');
                await world.engine.advance(20_000);
                expect(world.peekDeckCardTitles('d1')).toBeUndefined();
                expect(world.peekCardTitle('c1')).toBeUndefined();
                expect(world.peekCardTitle('c2')).toBeUndefined();
                const again = world.renderDeckCards('d1');
                await world.engine.settle();
                expect(world.server.requested).toEqual(['deckCards:d1', 'deckCards:d1']);
                expect(last(again.frames)).toBe('Ace,Two');
                again.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('drops a bucket nobody reads while its summary is read, and the summary once nobody reads it', async () => {
            useFakeTimers();
            try {
                const world = createWorld('createNeuron', { cards: 10_000, cardsPage: 10_000 });
                const summary = world.renderCardsPageSummary('d1');
                await world.engine.settle();
                expect(last(summary.frames)).toBe('2');
                expect(world.peekCardsPageTitles('d1')).toBe('Ace,Two');
                await world.engine.advance(20_000);
                expect(world.peekCardsPageTitles('d1')).toBeUndefined();
                expect(world.peekCardTitle('c1')).toBeUndefined();
                expect(world.peekCardsPageTotal('d1')).toBe(2);
                summary.dispose();
                await world.engine.settle();
                await world.engine.advance(20_000);
                expect(world.peekCardsPageTotal('d1')).toBeUndefined();
                const again = world.renderCardsPageSummary('d1');
                await world.engine.settle();
                expect(world.server.requested).toEqual(['cardsPage:d1:start', 'cardsPage:d1:start']);
                expect(last(again.frames)).toBe('2');
                again.dispose();
            } finally {
                jest.useRealTimers();
            }
        });

        it('drops what nobody reads at the next release by default', async () => {
            useFakeTimers();
            try {
                const world = createWorld();
                const page = world.renderCardsPage('d1');
                await world.engine.settle();
                page.dispose();
                await world.engine.settle();
                await world.engine.advance(0);
                expect(world.peekCardsPageTitles('d1')).toBeUndefined();
                expect(world.peekCardsPageTotal('d1')).toBeUndefined();
                expect(world.peekCardTitle('c1')).toBeUndefined();
            } finally {
                jest.useRealTimers();
            }
        });

        it('builds the owner neurons when no factories are given, and refuses a model attached to no neuron, to two, or twice to one', () => {
            const { deckModelDefinition } = createDeckModelDefinition(createServer());
            const assemble = (neuronFactories: TCNSHomeostatSchemaOptions<{ deckModel: typeof deckModelDefinition }, THandles>['neuronFactories']) => () =>
                assembleCNSHomeostatSchema<THandles, { deckModel: typeof deckModelDefinition }>(createEngine().createBinding(), {
                    homeostatModels: { deckModel: deckModelDefinition },
                    neuronFactories,
                });
            const refusalOf = (neuronCount: number) =>
                `assembleCNSHomeostatSchema: the homeostatDendrites of the homeostat model "deckModel" must be attached once each to exactly one neuron, the model's own; they are attached to ${neuronCount} neurons`;
            expect(assemble({ otherNeuron: () => neuron({}) })).toThrow(refusalOf(0));
            expect(Object.keys(assemble(undefined)().neurons)).toEqual(['deckModelNeuron']);
            expect(assemble({ deckNeuron: ({ deckModel }) => deckModel.createNeuron(), copyNeuron: ({ deckModel }) => deckModel.createNeuron() })).toThrow(refusalOf(2));
            expect(assemble({ deckNeuron: ({ deckModel }) => deckModel.createNeuron().dendrite(deckModel.homeostatDendrites) })).toThrow(refusalOf(1));
            expect(assemble({ deckNeuron: ({ deckModel }) => deckModel.createNeuron() })).not.toThrow();
        });

        it('refuses a neuron factory listed under two names', () => {
            const { deckModelDefinition } = createDeckModelDefinition(createServer());
            const createDeckNeuron = ({ deckModel }: TCNSHomeostatNeuronDependencies<{ deckModel: typeof deckModelDefinition }, THandles>) => deckModel.createNeuron();
            expect(() => assembleCNSHomeostatSchema<THandles, { deckModel: typeof deckModelDefinition }>(createEngine().createBinding(), {
                homeostatModels: { deckModel: deckModelDefinition },
                neuronFactories: { deckNeuron: createDeckNeuron, sameDeckNeuron: createDeckNeuron },
            })).toThrow('assembleCNSHomeostatSchema: a neuron factory is listed twice; every dendrite of its neuron would run twice');
        });

        it('refuses a model named after a member of the schema', () => {
            const { deckModelDefinition } = createDeckModelDefinition(createServer());
            expect(() => assembleCNSHomeostatSchema<THandles, { cns: typeof deckModelDefinition }>(createEngine().createBinding(), {
                homeostatModels: { cns: deckModelDefinition },
                neuronFactories: { cnsNeuron: ({ cns }) => cns.createNeuron() },
            })).toThrow('assembleCNSHomeostatSchema: a homeostat model cannot be named "cns"; the schema has a member of that name');
        });

        it('gives a collection with a homeostatReceptor a reader under its name, and a collection without one none', () => {
            const world = createWorld();
            const deckModel = world.schema.deckModel;
            expect(deckModel.cards.collection).toBe(deckModel.collections.cards);
            expect(deckModel.cards.homeostasis).toBe(deckModel.homeostasis.cards);
            expect(deckModel.cards.keyOf('c9')).toEqual(['c9']);
            const tagModelDefinition = defineCNSHomeostatModel(deckAxon).collection('tags', { idOf: (tag: { id: string }) => tag.id });
            const tagSchema = assembleCNSHomeostatSchema<THandles, { tagModel: typeof tagModelDefinition }>(world.engine.createBinding(), {
                homeostatModels: { tagModel: tagModelDefinition },
            });
            expect(Object.keys(tagSchema.tagModel)).not.toContain('tags');
            tagSchema.dispose();
            world.schema.dispose();
        });

        it('refuses a collection with a homeostatReceptor named after a member of the model', () => {
            const { cardReceptor } = createDeckModelDefinition(createServer());
            for (const memberName of ['collections', 'buckets', 'summaries', 'homeostasis', 'homeostatDendrites', 'createNeuron']) {
                expect(() => defineCNSHomeostatModel(deckAxon).collection(memberName, { idOf: (card: TCard) => card.id, homeostatReceptor: cardReceptor }))
                    .toThrow(`CNSHomeostatModelDefinition: a collection with a homeostatReceptor cannot be named "${memberName}"; the model has a member of that name`);
            }
            expect(() => defineCNSHomeostatModel(deckAxon).collection('buckets', { idOf: (card: TCard) => card.id })).not.toThrow();
        });
    });
}
