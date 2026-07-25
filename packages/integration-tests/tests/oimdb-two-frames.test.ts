import { OIMEventQueue, OIMReactiveCollection } from '@oimdb/core';
import { CNS, collateral, neuron } from '@cnstra/core';

/**
 * The showcase for the recipe: two independent collections, written by two
 * independent neurons, on either side of one request - and the UI observes
 * exactly two frames, each internally consistent.
 *
 *   turn 1 (synchronous, inside stimulate())
 *     cardLoading  -> card.loading  = true
 *     deckLoading  -> deck.loading  = true
 *     fetcher      -> starts, returns a promise
 *     DRAIN -> flush -> frame 1: BOTH spinners, together
 *
 *   turn 2 (after the request settles)
 *     applyCard    -> card data + loading = false
 *     applyDeck    -> deck data + loading = false
 *     DRAIN -> flush -> frame 2: BOTH filled, together
 *
 * Nothing coordinates the two neurons. They do not know about each other. The
 * batching falls out of the graph.
 */

type Card = { id: string; title?: string; loading?: boolean };
type Deck = { id: string; name?: string; loading?: boolean };

describe('OIMDB: two neurons, one request, exactly two frames', () => {
    it('renders both spinners together, then both results together', async () => {
        const queue = new OIMEventQueue(); // no scheduler
        const cards = new OIMReactiveCollection<Card, string>(queue, {
            selectPk: c => c.id!,
        });
        const decks = new OIMReactiveCollection<Deck, string>(queue, {
            selectPk: d => d.id!,
        });

        const cardOpened = collateral<{ cardId: string; deckId: string }>();
        const loaded = collateral<{
            cardId: string;
            deckId: string;
            title: string;
            name: string;
        }>();

        // --- turn 1: three independent subscribers of the same signal ---

        const cardLoading = neuron({}).dendrite({
            collateral: cardOpened,
            response: p => {
                cards.upsertOneByPk(p!.cardId, { id: p!.cardId, loading: true });
                return undefined;
            },
        });

        const deckLoading = neuron({}).dendrite({
            collateral: cardOpened,
            response: p => {
                decks.upsertOneByPk(p!.deckId, { id: p!.deckId, loading: true });
                return undefined;
            },
        });

        const fetcher = neuron({ loaded }).dendrite({
            collateral: cardOpened,
            response: async (p, axon) => {
                await new Promise(r => setTimeout(r, 5));
                return axon.loaded.createSignal({
                    cardId: p!.cardId,
                    deckId: p!.deckId,
                    title: 'Hydration',
                    name: 'Biology',
                });
            },
        });

        // --- turn 2: two independent subscribers of the result ---

        const applyCard = neuron({}).dendrite({
            collateral: loaded,
            response: p => {
                cards.upsertOneByPk(p!.cardId, {
                    id: p!.cardId,
                    title: p!.title,
                    loading: false,
                });
                return undefined;
            },
        });

        const applyDeck = neuron({}).dendrite({
            collateral: loaded,
            response: p => {
                decks.upsertOneByPk(p!.deckId, {
                    id: p!.deckId,
                    name: p!.name,
                    loading: false,
                });
                return undefined;
            },
        });

        const cns = new CNS([
            cardLoading,
            deckLoading,
            fetcher,
            applyCard,
            applyDeck,
        ]);

        // The integration: one line.
        const offFlush = cns.addDrainListener(() => queue.flush());

        let cardNotifications = 0;
        let deckNotifications = 0;
        cards.subscribeOnKey('c1', () => { cardNotifications++; });
        decks.subscribeOnKey('d1', () => { deckNotifications++; });

        // Registered after the flush listener, so it sees post-flush state -
        // this is what a renderer would paint for the frame.
        const frames: string[] = [];
        const offFrame = cns.addDrainListener(() => {
            const c = cards.getOneByPk('c1');
            const d = decks.getOneByPk('d1');
            if (!c && !d) return;
            frames.push(
                `card(${c?.title ?? '-'}, loading=${c?.loading}) ` +
                `deck(${d?.name ?? '-'}, loading=${d?.loading})`
            );
        });

        await cns
            .stimulate(cardOpened.createSignal({ cardId: 'c1', deckId: 'd1' }))
            .waitUntilComplete();

        offFlush();
        offFrame();

        // Exactly two frames, each internally consistent: never a spinner on one
        // side and data on the other.
        expect(frames).toEqual([
            'card(-, loading=true) deck(-, loading=true)',
            'card(Hydration, loading=false) deck(Biology, loading=false)',
        ]);

        // Four writes across four neurons collapsed into two notifications each.
        expect(cardNotifications).toBe(2);
        expect(deckNotifications).toBe(2);
    });
});
