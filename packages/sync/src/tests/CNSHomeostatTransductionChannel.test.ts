import { CNSHomeostatBatchTransducer, CNSHomeostatTransductionChannel, CNSHomeostatTransductionEndpoint } from '../index';
import type { TCNSHomeostatTransductionChannelRequest } from '../index';
import { createCNSHomeostatTestDeckServer } from './support/cnsHomeostatTestSupport';

const createChannel = (options: { answer?: (request: TCNSHomeostatTransductionChannelRequest) => void; timeoutMs?: number } = {}) => {
    const deckServer = createCNSHomeostatTestDeckServer();
    const homeostatTransductionEndpoint = new CNSHomeostatTransductionEndpoint({
        batchTransduceFn: homeostatTransductionRequests => Promise.resolve(deckServer.joinDecksWithCards(homeostatTransductionRequests)),
    });
    const sentRequests: TCNSHomeostatTransductionChannelRequest[] = [];
    const homeostatTransductionChannel: CNSHomeostatTransductionChannel = new CNSHomeostatTransductionChannel({
        timeoutMs: options.timeoutMs,
        sendRequest: request => {
            sentRequests.push(request);
            if (options.answer !== undefined) {
                options.answer(request);
                return;
            }
            void homeostatTransductionEndpoint.respond(request.encodedRequests, request.mediaType)
                .then(response => homeostatTransductionChannel.receiveResponse({ requestId: request.requestId, ...response }));
        },
    });
    const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({ batchTransduceFn: homeostatTransductionChannel.batchTransduceFn });
    return {
        sentRequests,
        homeostatTransductionChannel,
        transduceDeck: homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deck', ([deck]) => deck),
        transduceDeckCards: homeostatBatchTransducer.transduceOf<[deckId: string], unknown>('deckCards', cards => cards),
    };
};

describe('the keys of a screen over a channel of messages', () => {
    it('sends every key asked in one window as one message and answers each from the response with its id', async () => {
        const { sentRequests, transduceDeck, transduceDeckCards } = createChannel();
        const abortSignal = new AbortController().signal;

        const answers = await Promise.all([transduceDeck(['d1'], abortSignal), transduceDeckCards(['d1'], abortSignal), transduceDeck(['d2'], abortSignal)]);

        expect(answers).toEqual([{ id: 'd1', title: 'Spades' }, [{ id: 'c1', deck: 'd1', title: 'Ace' }], { id: 'd2', title: 'Hearts' }]);
        expect(sentRequests).toEqual([{ requestId: '1', mediaType: 'application/vnd.cnstra.transduction-query.v1+json', encodedRequests: 'deck=d1;d2&deckCards=d1' }]);
    });

    it('fails each key of a message the other side answered with a status other than 200, with that status', async () => {
        const holder: { channel?: CNSHomeostatTransductionChannel } = {};
        const { homeostatTransductionChannel } = createChannel({
            answer: request => queueMicrotask(() => holder.channel?.receiveResponse({ requestId: request.requestId, status: 406, headers: {}, body: 'no' })),
        });
        holder.channel = homeostatTransductionChannel;

        const rows = await homeostatTransductionChannel.batchTransduceFn([{ name: 'deck', key: ['d1'] }], new AbortController().signal);

        expect(rows).toEqual([{ name: 'deck', key: ['d1'], error: expect.objectContaining({ status: 406 }) }]);
    });

    it('fails the keys of a message that could not be sent, so the refractory policy can ask them again', async () => {
        const { homeostatTransductionChannel } = createChannel({ answer: () => { throw new Error('socket is closed'); } });

        const rows = await homeostatTransductionChannel.batchTransduceFn([{ name: 'deck', key: ['d1'] }], new AbortController().signal);

        expect(rows).toEqual([{ name: 'deck', key: ['d1'], error: new Error('socket is closed') }]);
    });

    it('fails the keys of a message nobody answered within timeoutMs, and drops a late answer', async () => {
        jest.useFakeTimers();
        try {
            const { homeostatTransductionChannel } = createChannel({ answer: () => undefined, timeoutMs: 1_000 });
            const transduced = homeostatTransductionChannel.batchTransduceFn([{ name: 'deck', key: ['d1'] }], new AbortController().signal);
            jest.advanceTimersByTime(1_000);
            const rows = await transduced;

            expect(String((rows[0] as { error: Error }).error.message)).toBe('homeostat transduction channel request 1: timed out after 1000 ms');
            expect(() => homeostatTransductionChannel.receiveResponse({ requestId: '1', status: 200, headers: {}, body: '[]' })).not.toThrow();
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects with the reason when the batch is aborted, and ignores an answer that arrives after', async () => {
        const { homeostatTransductionChannel } = createChannel({ answer: () => undefined });
        const abortController = new AbortController();
        const transduced = homeostatTransductionChannel.batchTransduceFn([{ name: 'deck', key: ['d1'] }], abortController.signal);

        abortController.abort(new Error('left the screen'));

        await expect(transduced).rejects.toThrow('left the screen');
        homeostatTransductionChannel.receiveResponse({ requestId: '1', status: 200, headers: {}, body: '[[0,{"id":"d1"}]]' });
    });

    it('ignores a response to a request id it never sent', () => {
        const { homeostatTransductionChannel } = createChannel();
        expect(() => homeostatTransductionChannel.receiveResponse({ requestId: 'other', status: 200, headers: {}, body: '[]' })).not.toThrow();
    });
});

describe('a channel that went away', () => {
    it('fails the keys of every message still waiting, and takes no answer for them after', async () => {
        const { homeostatTransductionChannel } = createChannel({ answer: () => undefined });
        const transduced = homeostatTransductionChannel.batchTransduceFn([{ name: 'deck', key: ['d1'] }], new AbortController().signal);

        homeostatTransductionChannel.failPendingRequests(new Error('socket closed'));

        expect(await transduced).toEqual([{ name: 'deck', key: ['d1'], error: new Error('socket closed') }]);
        expect(() => homeostatTransductionChannel.receiveResponse({ requestId: '1', status: 200, headers: {}, body: '[]' })).not.toThrow();
    });
});
