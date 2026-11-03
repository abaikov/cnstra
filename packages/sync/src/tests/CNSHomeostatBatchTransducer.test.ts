import { CNSHomeostatBatchTransducer } from '../index';
import type { TCNSHomeostatTransductionRequest, TCNSHomeostatTransductionRow } from '../index';
import { cnsAt, cnsSettleMicrotasks, createCNSHomeostatTestDeckServer } from './support/cnsHomeostatTestSupport';
import type { TCNSHomeostatTestCard, TCNSHomeostatTestDeck } from './support/cnsHomeostatTestSupport';

type TDeck = TCNSHomeostatTestDeck;
type TCard = TCNSHomeostatTestCard;

const deckServer = createCNSHomeostatTestDeckServer();
const joinDecksWithCards = deckServer.joinDecksWithCards;
const decks = deckServer.decks;

function createDeckTransducer(batchTransduceFn?: (
    homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[],
    abortSignal: AbortSignal
) => Promise<readonly TCNSHomeostatTransductionRow[]>) {
    const sentBatches: { homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]; abortSignal: AbortSignal }[] = [];
    const scheduledBatches: (() => void)[] = [];
    const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
        batchTransduceFn: (homeostatTransductionRequests, abortSignal) => {
            sentBatches.push({ homeostatTransductionRequests, abortSignal });
            return batchTransduceFn?.(homeostatTransductionRequests, abortSignal) ?? Promise.resolve(joinDecksWithCards(homeostatTransductionRequests));
        },
        batchScheduleFn: sendBatch => { scheduledBatches.push(sendBatch); },
    });
    const transduceDeck = homeostatBatchTransducer.transduceOf<[deckId: string], TDeck | undefined>('deck', ([deck]) => deck as TDeck | undefined);
    const transduceDeckCards = homeostatBatchTransducer.transduceOf<[deckId: string], TCard[]>('deckCards', values => values as TCard[]);
    const sendScheduledBatches = () => {
        for (const sendBatch of scheduledBatches.splice(0)) sendBatch();
    };
    return { sentBatches, transduceDeck, transduceDeckCards, sendScheduledBatches };
}

describe('the batch transducer', () => {
    it('sends a deck and the cards of the deck in one batch and answers each key with its own rows of a flat list', async () => {
        const { sentBatches, transduceDeck, transduceDeckCards, sendScheduledBatches } = createDeckTransducer();

        const deck = transduceDeck(['d1'], new AbortController().signal);
        const deckCards = transduceDeckCards(['d1'], new AbortController().signal);
        const otherDeckCards = transduceDeckCards(['d2'], new AbortController().signal);
        sendScheduledBatches();

        expect(sentBatches.map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([[
            { name: 'deck', key: ['d1'] },
            { name: 'deckCards', key: ['d1'] },
            { name: 'deckCards', key: ['d2'] },
        ]]);
        await expect(deck).resolves.toEqual({ id: 'd1', title: 'Spades' });
        await expect(deckCards).resolves.toEqual([{ id: 'c1', deck: 'd1', title: 'Ace' }]);
        await expect(otherDeckCards).resolves.toEqual([{ id: 'c2', deck: 'd2', title: 'Two' }]);
    });

    it('waits for runs queued in later microtasks before it sends, by default until the next macrotask', async () => {
        const sentBatches: (readonly TCNSHomeostatTransductionRequest[])[] = [];
        const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
            batchTransduceFn: homeostatTransductionRequests => {
                sentBatches.push(homeostatTransductionRequests);
                return Promise.resolve(joinDecksWithCards(homeostatTransductionRequests));
            },
        });
        const transduceDeck = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck);
        const transduceDeckCards = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deckCards', values => values);

        const deck = transduceDeck(['d1'], new AbortController().signal);
        let deckCards: Promise<unknown> | undefined;
        queueMicrotask(() => queueMicrotask(() => { deckCards = transduceDeckCards(['d1'], new AbortController().signal); }));
        await new Promise(resolve => setTimeout(resolve, 0));
        await deck;
        await deckCards;

        expect(sentBatches).toEqual([[{ name: 'deck', key: ['d1'] }, { name: 'deckCards', key: ['d1'] }]]);
    });

    it('sends a key asked twice in one batch once and answers both', async () => {
        const { sentBatches, transduceDeck, sendScheduledBatches } = createDeckTransducer();

        const first = transduceDeck(['d1'], new AbortController().signal);
        const second = transduceDeck(['d1'], new AbortController().signal);
        sendScheduledBatches();

        expect(cnsAt(sentBatches, 0).homeostatTransductionRequests).toEqual([{ name: 'deck', key: ['d1'] }]);
        await expect(first).resolves.toEqual({ id: 'd1', title: 'Spades' });
        await expect(second).resolves.toEqual({ id: 'd1', title: 'Spades' });
    });

    it('leaves a key aborted before the batch out of the request and sends nothing when every key is aborted', async () => {
        const { sentBatches, transduceDeck, sendScheduledBatches } = createDeckTransducer();
        const aborted = new AbortController();

        const left = transduceDeck(['d1'], aborted.signal);
        const kept = transduceDeck(['d2'], new AbortController().signal);
        aborted.abort('left the screen');
        sendScheduledBatches();
        const alone = new AbortController();
        const leftAlone = transduceDeck(['d1'], alone.signal);
        alone.abort('left the screen');
        sendScheduledBatches();

        await expect(left).rejects.toBe('left the screen');
        await expect(kept).resolves.toEqual({ id: 'd2', title: 'Hearts' });
        await expect(leftAlone).rejects.toBe('left the screen');
        expect(sentBatches.map(sentBatch => sentBatch.homeostatTransductionRequests)).toEqual([[{ name: 'deck', key: ['d2'] }]]);
    });

    it('rejects an already aborted key at once without a batch', async () => {
        const { sentBatches, transduceDeck, sendScheduledBatches } = createDeckTransducer();
        const aborted = new AbortController();
        aborted.abort('gone');

        await expect(transduceDeck(['d1'], aborted.signal)).rejects.toBe('gone');
        sendScheduledBatches();
        expect(sentBatches).toEqual([]);
    });

    it('aborts the sent batch only when every key of it is aborted', async () => {
        let resolveBatch: (homeostatTransductionRows: TCNSHomeostatTransductionRow[]) => void = () => undefined;
        const { sentBatches, transduceDeck, transduceDeckCards, sendScheduledBatches } = createDeckTransducer(
            () => new Promise(resolve => { resolveBatch = resolve; })
        );
        const deckAbort = new AbortController();
        const deckCardsAbort = new AbortController();

        const deck = transduceDeck(['d1'], deckAbort.signal);
        const deckCards = transduceDeckCards(['d1'], deckCardsAbort.signal);
        sendScheduledBatches();
        const batchAbortSignal = cnsAt(sentBatches, 0).abortSignal;
        deckAbort.abort('deck left');

        await expect(deck).rejects.toBe('deck left');
        expect(batchAbortSignal.aborted).toBe(false);
        deckCardsAbort.abort('cards left');
        await expect(deckCards).rejects.toBe('cards left');
        expect(batchAbortSignal.aborted).toBe(true);
        resolveBatch(joinDecksWithCards(cnsAt(sentBatches, 0).homeostatTransductionRequests));
        await cnsSettleMicrotasks();
    });

    it('rejects only the key whose row is an error', async () => {
        const { transduceDeck, sendScheduledBatches } = createDeckTransducer();

        const missing = transduceDeck(['d9'], new AbortController().signal);
        const found = transduceDeck(['d1'], new AbortController().signal);
        sendScheduledBatches();

        await expect(missing).rejects.toEqual({ status: 404 });
        await expect(found).resolves.toEqual({ id: 'd1', title: 'Spades' });
    });

    it('answers a key answered with no rows with an empty list, fails a key the server did not answer, and rejects only the key whose parse throws', async () => {
        const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
            batchTransduceFn: homeostatTransductionRequests => Promise.resolve(joinDecksWithCards(homeostatTransductionRequests)),
            batchScheduleFn: sendBatch => { queueMicrotask(sendBatch); },
        });
        const transduceDeckCards = homeostatBatchTransducer.transduceOf<[deckId: string], unknown[]>('deckCards', values => [...values]);
        const transduceStrictDeckCards = homeostatBatchTransducer.transduceOf<[deckId: string], unknown[]>('deckCards', values => {
            if (values.length === 0) throw new Error('no cards');
            return [...values];
        });

        const transduceDeckStats = homeostatBatchTransducer.transduceOf<[deckId: string], unknown[]>('deckStats', values => [...values]);

        await expect(transduceDeckCards(['d9'], new AbortController().signal)).resolves.toEqual([]);
        await expect(transduceStrictDeckCards(['d9'], new AbortController().signal)).rejects.toThrow('no cards');
        await expect(transduceDeckStats(['d1'], new AbortController().signal)).rejects.toThrow('deckStats ["d1"] was not answered');
    });

    it('rejects every key of a batch whose transport fails, thrown or rejected', async () => {
        const rejecting = createDeckTransducer(() => Promise.reject(new Error('HTTP 503')));
        const throwing = createDeckTransducer(() => { throw new Error('offline'); });

        const deck = rejecting.transduceDeck(['d1'], new AbortController().signal);
        const deckCards = rejecting.transduceDeckCards(['d1'], new AbortController().signal);
        const thrownDeck = throwing.transduceDeck(['d1'], new AbortController().signal);
        rejecting.sendScheduledBatches();
        throwing.sendScheduledBatches();

        await expect(deck).rejects.toThrow('HTTP 503');
        await expect(deckCards).rejects.toThrow('HTTP 503');
        await expect(thrownDeck).rejects.toThrow('offline');
    });

    it('sends a key at once with a scheduler that sends at once', async () => {
        const sentBatches: (readonly TCNSHomeostatTransductionRequest[])[] = [];
        const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
            batchTransduceFn: homeostatTransductionRequests => {
                sentBatches.push(homeostatTransductionRequests);
                return Promise.resolve(joinDecksWithCards(homeostatTransductionRequests));
            },
            batchScheduleFn: sendBatch => sendBatch(),
        });
        const transduceDeck = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck);

        await expect(transduceDeck(['d1'], new AbortController().signal)).resolves.toEqual({ id: 'd1', title: 'Spades' });
        await expect(transduceDeck(['d2'], new AbortController().signal)).resolves.toEqual({ id: 'd2', title: 'Hearts' });
        expect(sentBatches).toEqual([[{ name: 'deck', key: ['d1'] }], [{ name: 'deck', key: ['d2'] }]]);
    });

    it('rejects the keys of a batch whose scheduler throws and starts the next batch afresh', async () => {
        let isSchedulerBroken = true;
        const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
            batchTransduceFn: homeostatTransductionRequests => Promise.resolve(joinDecksWithCards(homeostatTransductionRequests)),
            batchScheduleFn: sendBatch => {
                if (isSchedulerBroken) throw new Error('no timers');
                sendBatch();
            },
        });
        const transduceDeck = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck);

        await expect(transduceDeck(['d1'], new AbortController().signal)).rejects.toThrow('no timers');
        isSchedulerBroken = false;
        await expect(transduceDeck(['d1'], new AbortController().signal)).resolves.toEqual({ id: 'd1', title: 'Spades' });
    });

    it('starts a new batch for keys asked after the batch was sent', async () => {
        const { sentBatches, transduceDeck, sendScheduledBatches } = createDeckTransducer();

        const first = transduceDeck(['d1'], new AbortController().signal);
        sendScheduledBatches();
        const second = transduceDeck(['d1'], new AbortController().signal);
        sendScheduledBatches();

        await Promise.all([first, second]);
        expect(sentBatches).toHaveLength(2);
    });
});

describe('an existing transport: JSON-RPC 2.0 batch', () => {
    it('maps the batch to JSON-RPC requests and matches responses that come back in any order by id', async () => {
        const jsonRpcBodies: unknown[] = [];
        const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({
            batchTransduceFn: async homeostatTransductionRequests => {
                const jsonRpcRequests = homeostatTransductionRequests.map(({ name, key }, id) => ({ jsonrpc: '2.0', id, method: name, params: key }));
                jsonRpcBodies.push(jsonRpcRequests);
                const jsonRpcResponses = jsonRpcRequests.reverse().map(({ id, method, params }) => method === 'deck'
                    ? { jsonrpc: '2.0', id, result: decks.find(deck => deck.id === params[0]) }
                    : { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
                return jsonRpcResponses.map(jsonRpcResponse => {
                    const { name, key } = cnsAt(homeostatTransductionRequests, jsonRpcResponse.id);
                    return 'error' in jsonRpcResponse ? { name, key, error: jsonRpcResponse.error } : { name, key, data: jsonRpcResponse.result };
                });
            },
        });
        const transduceDeck = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck);
        const transduceDeckCards = homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deckCards', values => values);

        const deck = transduceDeck(['d2'], new AbortController().signal);
        const deckCards = transduceDeckCards(['d2'], new AbortController().signal);

        await expect(deck).resolves.toEqual({ id: 'd2', title: 'Hearts' });
        await expect(deckCards).rejects.toEqual({ code: -32601, message: 'Method not found' });
        expect(jsonRpcBodies).toHaveLength(1);
    });
});
