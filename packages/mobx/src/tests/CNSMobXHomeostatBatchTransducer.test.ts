import { CNS, neuron } from '@cnstra/core';
import { autorun, observable } from 'mobx';
import { CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS, CNSHomeostatBatchTransducer, CNSHomeostatReceptor, CNSHomeostatReceptorCorrection } from '@cnstra/sync';
import { createCNSMobXHomeostatEnvironment } from '../index';
import { createCNSHomeostatTestDeckServer } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';
import type { TCNSHomeostatTestCard as TCard, TCNSHomeostatTestDeck as TDeck } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

const createApp = () => {
    const deckServer = createCNSHomeostatTestDeckServer();
    const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({ batchTransduceFn: deckServer.batchTransduceFn });
    const decks = observable.map<string, TDeck>();
    const cardsByDeck = observable.map<string, TCard[]>();
    const deckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
        name: 'deck',
        staleTimeMs: 30_000,
        transduce: homeostatBatchTransducer.transduceOf('deck', ([deck]) => deck as TDeck),
    });
    const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCard[]>({
        name: 'deckCards',
        staleTimeMs: 2_000,
        transduce: homeostatBatchTransducer.transduceOf('deckCards', cards => cards as TCard[]),
    });
    const writer = neuron({})
        .dendrite({ collateral: deckReceptor.axon.homeostasisRestored, response: ({ data }) => { decks.set(data.id, data); } })
        .dendrite({
            collateral: deckCardsReceptor.axon.homeostasisRestored,
            response: ({ key: [deckId], data }) => {
                if (JSON.stringify(cardsByDeck.get(deckId)) !== JSON.stringify(data)) cardsByDeck.set(deckId, data);
            },
        });
    const cns = new CNS([
        deckReceptor.neuron,
        deckCardsReceptor.neuron,
        new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor, deckCardsReceptor] }).neuron,
        writer,
    ]);
    const homeostatEnvironment = createCNSMobXHomeostatEnvironment({ cns });
    const renderDecks = (deckIds: string[]) => {
        const frames: string[] = [];
        const dispose = autorun(() => {
            frames.push(deckIds.map(deckId => {
                const deckHomeostasis = homeostatEnvironment.createComputed(deckReceptor, [deckId]).get();
                homeostatEnvironment.createComputed(deckCardsReceptor, [deckId]).get();
                return `${deckHomeostasis.status}:${decks.get(deckId)?.title ?? '-'}:${cardsByDeck.get(deckId)?.map(card => card.id).join(',') ?? '-'}`;
            }).join(' '));
        });
        return { frames, dispose };
    };
    return { deckServer, renderDecks };
};

describe('one request for what a MobX screen reads', () => {
    beforeEach(() => { jest.useFakeTimers({ now: CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS * 1_000 }); });
    afterEach(() => { jest.useRealTimers(); });

    it('asks for two decks and their cards in one batch and renders once more with every answer', async () => {
        const app = createApp();

        const screen = app.renderDecks(['d1', 'd2']);
        await jest.advanceTimersByTimeAsync(1);

        expect(app.deckServer.sentBatches.map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([[
            { name: 'deck', key: ['d1'] },
            { name: 'deckCards', key: ['d1'] },
            { name: 'deck', key: ['d2'] },
            { name: 'deckCards', key: ['d2'] },
        ]]);
        expect(screen.frames).toEqual(['firing:-:- firing:-:-', 'restored:Spades:c1 restored:Hearts:c2']);
        screen.dispose();
    });

    it('polls the cards of every deck on the screen in one request per poll, renders the firing of the poll and its answer, leaves the decks alone and stops when the screen goes', async () => {
        const app = createApp();
        const screen = app.renderDecks(['d1', 'd2']);
        await jest.advanceTimersByTimeAsync(1);
        app.deckServer.cards.push({ id: 'c3', deck: 'd1', title: 'Three' });

        await jest.advanceTimersByTimeAsync(2_000 + CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS);
        await jest.advanceTimersByTimeAsync(2_000 + CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS);
        await jest.advanceTimersByTimeAsync(1);

        expect(app.deckServer.sentBatches.slice(1).map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([
            [{ name: 'deckCards', key: ['d1'] }, { name: 'deckCards', key: ['d2'] }],
            [{ name: 'deckCards', key: ['d1'] }, { name: 'deckCards', key: ['d2'] }],
        ]);
        expect(screen.frames.slice(2)).toEqual([
            'restored:Spades:c1 restored:Hearts:c2',
            'restored:Spades:c1,c3 restored:Hearts:c2',
            'restored:Spades:c1,c3 restored:Hearts:c2',
            'restored:Spades:c1,c3 restored:Hearts:c2',
        ]);
        screen.dispose();
        await jest.advanceTimersByTimeAsync(10_000);
        expect(app.deckServer.sentBatches).toHaveLength(3);
    });
});
