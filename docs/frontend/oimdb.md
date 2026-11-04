---
id: oimdb
title: CNStra & OIMDB — State That the Graph Writes
sidebar_label: CNStra & OIMDB
slug: /frontend/oimdb
description: CNStra decides what happens, OIMDB holds the state it happens to. Build the database per app, write it only from neurons, commit once per turn of the graph, and read it from React or Exodra.
keywords: [OIMDB, CNStra, state management, Redux alternative, normalized store, indexes, React, Exodra, drain listener, one frame per turn]
---

CNStra decides what happens and in what order; [OIMDB](https://oimdb.org/) holds the state it happens to. Neurons are the only writers, the views only read and stimulate, and one drain listener turns every turn of the graph into one OIMDB frame.

```sh
npm install @cnstra/core @oimdb/core @oimdb/react
```

```ts setup
import * as React from 'react';
import { collateral, createCNS, neuron } from '@cnstra/core';
import { OIMDB, createOIMEntityContentService, createOIMEntitySlotCollectionStoreAggregate, createOIMSingleSlotStoreAggregate, createOIMSlotCollectionIndexStoreAggregate } from '@oimdb/core';
import { OIMDBProvider, useOIMBucketMemberKeysByKey, useOIMEntityByKey, useOIMSingleEntity } from '@oimdb/react';

type TDeck = { id: string; title: string };
type TCard = { id: string; deckId: string; title: string };
declare function fetchDecks(): Promise<TDeck[]>;
declare const root: { render(element: React.ReactElement): void };
```

## The database, built per app

The schema is a function of the database: collections, the indexes over them, single slots. `createSchemas` builds it with the database, so a test or a server request calls the same function and gets its own.

```ts setup shown
const createDeckSchema = (db: OIMDB) => {
    const decks = createOIMEntitySlotCollectionStoreAggregate<TDeck>(db);
    const cards = createOIMEntitySlotCollectionStoreAggregate<TCard>(db);
    const cardsByDeck = createOIMSlotCollectionIndexStoreAggregate(cards, { selectKey: (card: TCard) => card.deckId });
    const loading = createOIMSingleSlotStoreAggregate(db, { slotContentService: createOIMEntityContentService<{ isLoading: boolean }>() });
    const selection = createOIMSingleSlotStoreAggregate(db, { slotContentService: createOIMEntityContentService<{ deckId: string }>() });
    return { decks, cards, cardsByDeck, loading, selection };
};
type TDeckSchema = ReturnType<typeof createDeckSchema>;
```

An index fills itself: every card written lands in the bucket of its `deckId`, and a bucket is filled from the cards already written the first time it is read.

## Neurons write it

Each neuron is a factory of the schema, in its own file if you like. The collaterals stay at module level — they are how the views and other neurons reach it.

```ts setup shown
const newDeckEntered = collateral<{ title: string; cardTitle: string }>();
const cardRenamed = collateral<{ cardId: string; title: string }>();
const cardRemoved = collateral<{ cardId: string }>();
const decksRequested = collateral();
const deckCreated = collateral<{ deckId: string; cardTitle: string }>();

const createDeckNeuron = ({ decks, selection }: TDeckSchema) => neuron({ deckCreated }).dendrite({
    collateral: newDeckEntered,
    response: ({ title, cardTitle }, axon) => {
        const deckId = crypto.randomUUID();
        decks.writeSlotContentByKey(deckId, { id: deckId, title });
        selection.writeSingleSlotContent({ deckId });
        return axon.deckCreated.createSignal({ deckId, cardTitle });
    },
});

const createCardNeuron = ({ cards }: TDeckSchema) => neuron({})
    .dendrite({
        collateral: deckCreated,
        response: ({ deckId, cardTitle }) => {
            const cardId = crypto.randomUUID();
            cards.writeSlotContentByKey(cardId, { id: cardId, deckId, title: cardTitle });
        },
    })
    .dendrite({
        collateral: cardRenamed,
        response: ({ cardId, title }) => { cards.peekSlotByKey(cardId)?.updateEntity({ title }); },
    })
    .dendrite({
        collateral: cardRemoved,
        response: ({ cardId }) => { cards.peekSlotByKey(cardId)?.clearSlotContent(); },
    });

const createDeckLoaderNeuron = ({ decks, loading }: TDeckSchema) => neuron({}).dendrite({
    collateral: decksRequested,
    response: async () => {
        loading.writeSingleSlotContent({ isLoading: true });
        try {
            const fetchedDecks = await fetchDecks();
            decks.writeInBatch(() => {
                for (const deck of fetchedDecks) decks.writeSlotContentByKey(deck.id, deck);
            });
        } finally {
            loading.clearSingleSlotContent();
        }
    },
});
```

Ids come from `crypto.randomUUID()`, which needs a secure context (https or localhost) in a browser and Node 19+. `writeSlotContentByKey` writes a whole value under a key; `updateEntity` on a slot takes a patch — named columns move, the rest stay; `peekSlotByKey` finds a slot without minting one; `clearSlotContent` removes the entity.

`createCNS` calls every factory with the same schema and checks its type against each of them:

```ts setup shown
const createDeckApp = () => {
    const db = new OIMDB({ createSchemas: db => ({ deck: createDeckSchema(db) }) });
    const cns = createCNS([createDeckNeuron, createCardNeuron, createDeckLoaderNeuron], db.schemas.deck);
    cns.addDrainListener(() => db.flush());
    return { db, cns };
};
```

Neurons that are already module values can take the database as the CNS global instead — see [Dependencies](/docs/core/api#dependencies-a-store-a-database-a-clock).

## One commit per turn

`cns.addDrainListener(() => db.flush())` is the one commit point. CNStra calls it at the end of every synchronous turn of every stimulation, so every write of a turn lands in one OIMDB frame: each effect runs at most once for it, and a screen never shows half a change. `newDeckEntered` above makes the deck neuron write the deck and emit `deckCreated`, and the card neuron writes the card in the same turn — the deck, the card and the `cardsByDeck` bucket arrive together.

A turn that awaits ends at the `await`. `decksRequested` writes `{ isLoading: true }`, and the drain shows it at once; when `fetchDecks` settles, the next turn writes the decks and clears the flag, and the next drain shows that. Nothing in the neuron or the view handles the two frames.

Several stimulations started from one place — the answers of one request batch, a burst of socket messages — commit once inside `cns.batch(() => { … })`; it covers what its function does synchronously, so a turn after an `await` commits on its own ([API](/docs/core/api#batch-boundaries-ondrain)).

**Every write goes through a neuron.** A slot written from a click handler, a socket callback or a timer is not committed by anyone: route the event into a stimulation and let the neuron write.

## React reads it

`OIMDBProvider` carries the database; a hook takes the collection, index or single it reads and re-renders on the frames that move it. A click stimulates — it never writes.

```tsx
const { db, cns } = createDeckApp();
const { decks, cards, cardsByDeck, loading, selection } = db.schemas.deck;

function Card({ cardId }: { cardId: string }) {
    const card = useOIMEntityByKey(cards, cardId);
    return (
        <li>
            {card?.title}
            <button onClick={() => cns.stimulate(cardRemoved.createSignal({ cardId }))}>×</button>
        </li>
    );
}

function Deck({ deckId }: { deckId: string }) {
    const deck = useOIMEntityByKey(decks, deckId);
    const cardIds = useOIMBucketMemberKeysByKey(cardsByDeck, deckId);
    return (
        <section>
            <h3>{deck?.title}</h3>
            <ul>{cardIds.map(cardId => <Card key={String(cardId)} cardId={String(cardId)} />)}</ul>
        </section>
    );
}

function Toolbar() {
    const loadingState = useOIMSingleEntity(loading);
    return (
        <button onClick={() => cns.stimulate(newDeckEntered.createSignal({ title: 'Inbox', cardTitle: 'First task' }))}>
            {loadingState?.isLoading ? 'Loading…' : 'New deck'}
        </button>
    );
}

function SelectedDeck() {
    const selected = useOIMSingleEntity(selection);
    return selected === undefined ? null : <Deck deckId={selected.deckId} />;
}

root.render(<OIMDBProvider db={db}><Toolbar /><SelectedDeck /></OIMDBProvider>);
cns.stimulate(decksRequested.createSignal());
```

On [Exodra](/docs/frontend/exodra), a machine reads the same slots in `db.createEffect`, and `@cnstra/exodra` turns its event ports into signals of the same CNS.

## Server data

To keep the collections equal to a server — loading, refetch, invalidation, retries, one request for a whole screen — `@cnstra/oimdb` binds the `@cnstra/sync` homeostat to OIMDB: [Sync (homeostat)](/docs/frontend/sync). Coming from Redux: [Migrating from Redux](/docs/frontend/redux-migration). The OIMDB side itself — collections, indexes, buckets you order yourself, effects, release policies, and a scheduler for an app without CNStra — is documented at [oimdb.org](https://oimdb.org/); its [OIMDB with cnstra](https://oimdb.org/docs/guides/with-cnstra) guide builds a whole todo list this way.
