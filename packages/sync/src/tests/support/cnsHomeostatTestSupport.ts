import { CNS } from '@cnstra/core';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection } from '@cnstra/sync';
import type { TCNSHomeostatReceptorOptions, TCNSHomeostatTransductionRequest, TCNSHomeostatTransductionRow } from '@cnstra/sync';

export async function cnsSettleMicrotasks(afterEachMicrotask?: () => void, microtaskCount = 8): Promise<void> {
    for (let i = 0; i < microtaskCount; i++) {
        await Promise.resolve();
        afterEachMicrotask?.();
    }
}

export function createCNSHomeostatTestDeckReceptor(
    options: Pick<TCNSHomeostatReceptorOptions<[deckId: string], { id: string }>, 'staleTimeMs'> = {}
) {
    const requested: string[] = [];
    const deckReceptor = new CNSHomeostatReceptor<[deckId: string], { id: string }>({
        name: 'deck',
        ...options,
        transduce: ([deckId]) => {
            requested.push(deckId);
            return Promise.resolve({ id: deckId });
        },
    });
    const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron]);
    return { requested, deckReceptor, cns };
}

export function cnsAt<TValue>(values: readonly TValue[], index: number): TValue {
    const value = values[index];
    if (value === undefined) throw new Error(`nothing at ${index} of ${values.length}`);
    return value;
}

export type TCNSHomeostatTestDeck = { id: string; title: string };

export type TCNSHomeostatTestCard = { id: string; deck: string; title: string };

export function createCNSHomeostatTestDeckServer() {
    const deckServer = {
        decks: [{ id: 'd1', title: 'Spades' }, { id: 'd2', title: 'Hearts' }] as TCNSHomeostatTestDeck[],
        cards: [{ id: 'c1', deck: 'd1', title: 'Ace' }, { id: 'c2', deck: 'd2', title: 'Two' }] as TCNSHomeostatTestCard[],
        missingCardsOf: new Set<string>(),
        hang: false,
        sentBatches: [] as { homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]; abortSignal: AbortSignal }[],
        heldAnswers: [] as (() => void)[],
        joinDecksWithCards: (homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): TCNSHomeostatTransductionRow[] => {
            const homeostatTransductionRows: TCNSHomeostatTransductionRow[] = [];
            for (const { name, key } of homeostatTransductionRequests) {
                const deckId = String(key[0]);
                if (name === 'deck') {
                    const deck = deckServer.decks.find(candidate => candidate.id === deckId);
                    homeostatTransductionRows.push(deck === undefined ? { name, key, error: { status: 404 } } : { name, key, data: deck });
                }
                if (name === 'deckCards' && deckServer.missingCardsOf.has(deckId)) homeostatTransductionRows.push({ name, key, error: { status: 404 } });
                else if (name === 'deckCards') {
                    const deckCards = deckServer.cards.filter(card => card.deck === deckId);
                    if (deckCards.length === 0) homeostatTransductionRows.push({ name, key });
                    for (const card of deckCards) homeostatTransductionRows.push({ name, key, data: card });
                }
            }
            return homeostatTransductionRows;
        },
        batchTransduceFn: (
            homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[],
            abortSignal: AbortSignal
        ): Promise<readonly TCNSHomeostatTransductionRow[]> => {
            deckServer.sentBatches.push({ homeostatTransductionRequests, abortSignal });
            const homeostatTransductionRows = deckServer.joinDecksWithCards(homeostatTransductionRequests);
            if (!deckServer.hang) return Promise.resolve(homeostatTransductionRows);
            return new Promise(resolve => { deckServer.heldAnswers.push(() => resolve(homeostatTransductionRows)); });
        },
        requestsOf: (index: number) => cnsAt(deckServer.sentBatches, index).homeostatTransductionRequests,
    };
    return deckServer;
}
