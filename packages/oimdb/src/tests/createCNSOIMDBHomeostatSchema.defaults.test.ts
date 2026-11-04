import { collateral } from '@cnstra/core';
import { OIMDB } from '@oimdb/core';
import { CNSHomeostatReceptor, defineCNSHomeostatModel } from '@cnstra/sync';
import { createCNSOIMDBHomeostatSchema } from '../index';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

type TCard = { id: string; title: string };

const settle = () => cnsSettleMicrotasks(undefined, 12);

describe('createCNSOIMDBHomeostatSchema defaults', () => {
    it('reads an entity through a receptor keyed by its id, given as the receptor alone, and builds the owner neuron itself', async () => {
        const db = new OIMDB();
        const requested: string[] = [];
        const cardReceptor = new CNSHomeostatReceptor<[cardId: string], TCard>({
            name: 'card',
            transduce: ([cardId]) => {
                requested.push(cardId);
                return Promise.resolve({ id: cardId, title: `card ${cardId}` });
            },
        });
        const deckModel = defineCNSHomeostatModel().collection('cards', { idOf: (card: TCard) => card.id, homeostatReceptor: cardReceptor });
        const schema = createCNSOIMDBHomeostatSchema(db, { homeostatModels: { deckModel } });
        const titles: (string | undefined)[] = [];

        const effect = db.createEffect(() => {
            titles.push(schema.deckModel.collections.cards.getSlotByKey('c42').entity?.title);
        });
        await settle();

        expect(requested).toEqual(['c42']);
        expect(titles[titles.length - 1]).toBe('card c42');
        expect(Object.keys(schema.neurons)).toEqual(['deckModelNeuron']);
        effect();
        schema.dispose();
        db.dispose();
    });

    it('infers a composite key from the receptor, so keyOf needs no tuple annotation', async () => {
        const db = new OIMDB();
        const cardReceptor = new CNSHomeostatReceptor<[deckId: string, cardId: string], TCard>({
            name: 'deckCard',
            transduce: ([, cardId]) => Promise.resolve({ id: cardId, title: `card ${cardId}` }),
        });
        const deckModel = defineCNSHomeostatModel({ cardsChanged: collateral<{ cardIds: string[] }>() }).collection('cards', {
            idOf: (card: TCard) => card.id,
            homeostatReceptor: { homeostatReceptor: cardReceptor, keyOf: cardId => ['d1', cardId] },
        });
        const schema = createCNSOIMDBHomeostatSchema(db, { homeostatModels: { deckModel } });
        const titles: (string | undefined)[] = [];

        const effect = db.createEffect(() => {
            titles.push(schema.deckModel.collections.cards.getSlotByKey('c7').entity?.title);
        });
        await settle();

        expect(titles[titles.length - 1]).toBe('card c7');
        effect();
        schema.dispose();
        db.dispose();
    });

});
