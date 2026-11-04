import { collateral, neuron } from '@cnstra/core';
import { OIMDB, OIMEffectService } from '@oimdb/core';
import { CNSHomeostatReceptor, defineCNSHomeostatModel, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import type { TCNSHomeostatModels } from '@cnstra/sync';
import { createCNSOIMDBHomeostatSchema } from '../index';
import type { ICNSOIMDBHomeostatModelHandles } from '../index';
import { cnsAt, cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

type TCard = { id: string; title: string };
type TCardsPage = { rows: TCard[]; total: number; nextCursor: string | undefined };

const deckAxon = { cardsChanged: collateral<{ cardIds: string[] }>() };
const deckUiAxon = { cardRenameRequested: collateral<{ cardId: string; title: string }>() };

const settle = () => cnsSettleMicrotasks(undefined, 12);
const last = (frames: readonly string[]) => cnsAt(frames, frames.length - 1);

const createDeckScreenApp = () => {
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
    const cardsPageReceptor = new CNSHomeostatReceptor<[deckId: string, cursor: string | undefined], TCardsPage>({
        name: 'cardsPage',
        transduce: ([deckId, cursor]) => {
            requested.push(`cardsPage:${deckId}:${cursor ?? 'start'}`);
            return Promise.resolve({ rows: [{ id: 'c1', title: `${deckId} card c1` }], total: 3, nextCursor: 'c1' });
        },
    });
    const deckModelDefinition = defineCNSHomeostatModel(deckAxon)
        .collection('cards', {
            idOf: (card: TCard) => card.id,
            homeostatReceptor: { homeostatReceptor: cardReceptor, keyOf: (cardId): [cardId: string] => [cardId] },
        })
        .homeostatReceptor('deckCards', {
            homeostatReceptor: deckCardsReceptor,
            bucketsOf: cards => ({ cards }),
            afterWrite: ({ insertedEntities, changedEntities }, axon) => {
                const writtenCards = [...insertedEntities.cards, ...changedEntities.cards];
                return writtenCards.length === 0 ? undefined : axon.cardsChanged.createSignal({ cardIds: writtenCards.map(card => card.id) });
            },
        })
        .homeostatReceptor('cardsPage', {
            homeostatReceptor: cardsPageReceptor,
            bucketsOf: page => ({ cards: page.rows }),
            summaryOf: page => ({ total: page.total, nextCursor: page.nextCursor }),
        });
    const changedCardIds: string[] = [];
    const createDeckNeuron = ({ deckModel }: TCNSHomeostatModels<{ deckModel: typeof deckModelDefinition }, ICNSOIMDBHomeostatModelHandles>) => deckModel.createNeuron()
        .dendrite({
            collateral: deckUiAxon.cardRenameRequested,
            response: ({ cardId, title }, axon) => {
                deckModel.collections.cards.writeSlotContentByKey(cardId, { id: cardId, title });
                return axon.cardsChanged.createSignal({ cardIds: [cardId] });
            },
        });
    const schema = createCNSOIMDBHomeostatSchema(db, {
        homeostatModels: { deckModel: deckModelDefinition },
        neuronFactories: {
            deckNeuron: createDeckNeuron,
            deckUiNeuron: () => neuron(deckUiAxon),
            cardsChangedNeuron: () => neuron({}).dendrite({ collateral: deckAxon.cardsChanged, response: ({ cardIds }) => { changedCardIds.push(cardIds.join(',')); } }),
        },
    });
    const { deckModel } = schema;
    const renderDeckCards = (deckId: string) => {
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            const cardSlots = Array.from(deckModel.buckets.deckCards.cards.getSlotByKey([deckId]).getBucketMemberSlots());
            frames.push(cardSlots.map(cardSlot => cardSlot.entity?.title ?? '-').join(','));
        });
        return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    const renderCardsPage = (deckId: string) => {
        const frames: string[] = [];
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(db, () => {
            const cardSlots = Array.from(deckModel.buckets.cardsPage.cards.getSlotByKey([deckId, undefined]).getBucketMemberSlots());
            const cardsPageSummary = deckModel.summaries.cardsPage.getSlotByKey([deckId, undefined]).entity;
            frames.push(`${cardSlots.map(cardSlot => cardSlot.entity?.title ?? '-').join(',')}|${cardsPageSummary?.total ?? '-'}|${cardsPageSummary?.nextCursor ?? '-'}`);
        });
        return { frames, dispose: () => OIMEffectService.INSTANCE.disposeEffect(effect) };
    };
    return { db, requested, schema, changedCardIds, deckCardsReceptor, renderDeckCards, renderCardsPage };
};

describe('createCNSOIMDBHomeostatSchema: a synced domain model on OIMDB', () => {
    it('asks one bucket request for a deck screen and no card one by one, and shows the loading state of the key', async () => {
        const app = createDeckScreenApp();
        const screen = app.renderDeckCards('d1');
        await settle();
        expect(app.requested).toEqual(['deckCards:d1']);
        expect(last(screen.frames)).toBe('d1 card c1,d1 card c2,d1 card c3');
        expect(app.schema.deckModel.homeostasis.deckCards.getSlotByKey(['d1']).value.error).toBeUndefined();
        expect(app.schema.deckModel.homeostasis.deckCards.getSlotByKey(['d1']).value.status).toBe(ECNSHomeostatCorrectionStatus.Restored);
        expect(app.changedCardIds).toEqual(['c1,c2,c3']);
        screen.dispose();
    });

    it('writes the model from a mutation dendrite of the domain neuron and commits it with the drain', async () => {
        const app = createDeckScreenApp();
        const screen = app.renderDeckCards('d1');
        await settle();
        await app.schema.cns.stimulate(deckUiAxon.cardRenameRequested.createSignal({ cardId: 'c2', title: 'renamed' })).waitUntilComplete();
        expect(last(screen.frames)).toBe('d1 card c1,renamed,d1 card c3');
        expect(app.changedCardIds).toEqual(['c1,c2,c3', 'c2']);
        screen.dispose();
    });

    it('reads a page answer as a bucket of rows and a value slot of the rest', async () => {
        const app = createDeckScreenApp();
        const page = app.renderCardsPage('d1');
        await settle();
        expect(app.requested).toEqual(['cardsPage:d1:start']);
        expect(last(page.frames)).toBe('d1 card c1|3|c1');
        page.dispose();
    });

    it('keeps the screen still when a refetch answers what it already shows', async () => {
        const app = createDeckScreenApp();
        const screen = app.renderDeckCards('d1');
        await settle();
        const frameCount = screen.frames.length;
        await app.schema.homeostatEnvironment.invalidate(app.deckCardsReceptor, ['d1']);
        await settle();
        expect(app.requested).toEqual(['deckCards:d1', 'deckCards:d1']);
        expect(screen.frames).toHaveLength(frameCount);
        expect(app.changedCardIds).toEqual(['c1,c2,c3']);
        screen.dispose();
    });

    it('stops the requests of the schema on dispose', async () => {
        const app = createDeckScreenApp();
        app.schema.dispose();
        const screen = app.renderDeckCards('d1');
        await settle();
        expect(app.requested).toEqual([]);
        screen.dispose();
    });
});
