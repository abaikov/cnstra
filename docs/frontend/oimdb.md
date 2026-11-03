---
id: oimdb
title: React State Management with CNStra & OIMDB - Redux Alternative
sidebar_label: CNStra & OIMDB
slug: /frontend/oimdb
description: Learn how CNStra + OIMDB provides deterministic React state management. A performant alternative to Redux, MobX, Zustand. Type-safe, derived state, reactive updates, SOLID/SRP by design. Perfect for complex React applications.
keywords: [React state management, Redux alternative, MobX alternative, Zustand alternative, Recoil alternative, Jotai alternative, React hooks, derived state, reactive state, OIMDB, in-memory database, frontend orchestration, React best practices, type-safe React state, deterministic React, performance optimization, state synchronization, React state machine]
---

# OIMDB: Reactive In-Memory Database for JavaScript

OIMDB (Object In-Memory Database) is a reactive in-memory database: normalized entities filed by key, indexes that fill themselves on write, and effects that hear exactly the slots they read. Nothing copies a state tree. Writes accumulate, and one `flush()` delivers them to every effect as one frame.

In OIMDB 4, **services hold no data; state lives on slots**. A collection service is built once per entity type, and `service.createStoreSlot(db)` makes one instance of that collection on an `OIMDB`. Each entity lives in its own slot, under the key you give it.

```ts setup
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import {
    OIMDB,
    OIMEffectService,
    OIMPositionalArrayBucketContentService,
    OIMSetBucketContentService,
    createOIMEntityContentService,
    createOIMSlotCollectionIndexService,
    createOIMSlotCollectionService,
} from '@oimdb/core';
import type { TOIMEntitySlot } from '@oimdb/core';
import { OIMDBProvider, useOIMBucketSlotsByKey, useOIMEntity } from '@oimdb/react';
```

## Why OIMDB?

Traditional state management approaches like Redux or MobX have limitations:

- **Tree copying overhead**: Immutable updates require copying large state trees, causing GC pressure
- **No built-in indexing**: Querying related data requires manual filtering or memoization
- **Fragile batching**: UI updates are batched inconsistently across frameworks
- **Complex coordination**: Multiple reducers need ad-hoc messaging to coordinate updates

OIMDB solves these problems with:

- **Normalized storage**: one slot per entity, found by key in a `Map`
- **Indexes that fill themselves**: an index files every written entity into the bucket of its key (e.g. "all posts by author")
- **Frames**: a write that changes nothing wakes nobody, and an effect runs at most once per flush, however many of its slots moved
- **No default scheduler**: whoever owns the unit of work decides when to flush — under CNStra, the end of every synchronous turn

## Installation

```bash
npm install @oimdb/core @oimdb/react
```

## Core Concepts

### Collections: Normalized Entity Storage

A collection is a service over an entity content service, plus a store slot per instance. The keyed write `writeSlotContentByKey` mints the slot on a miss and writes the whole value on a hit. There are no bulk writes: a load is a loop of single writes inside `writeInBatch`, so an index on the collection hears the whole loop in one call.

```ts setup shown
type User = { id: string; name: string; email: string; teamId: string };

const db = new OIMDB();
const userService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<User>() });
const users = userService.createStoreSlot(db);

userService.writeInBatch(users, () => {
    userService.writeSlotContentByKey(users, 'u1', { id: 'u1', name: 'Ann', email: 'ann@example.com', teamId: 'engineering' });
    userService.writeSlotContentByKey(users, 'u2', { id: 'u2', name: 'Bob', email: 'bob@example.com', teamId: 'engineering' });
});
```

Reads take the store slot first. `peekSlotByKey` mints nothing; `getSlotByKey` always returns a slot. `updateEntity` on a slot takes a **patch** — named columns move, the rest stay — while `writeSlotContentByKey` takes a **whole value**:

```ts
const bob = userService.peekSlotByKey(users, 'u2')?.entity;

const annSlot = userService.getSlotByKey(users, 'u1');
annSlot.updateEntity({ email: 'ann@team.dev' });
```

### Effects: Reacting to Writes

An effect names the slots it reads and runs when any of them moves. It receives no payload — read the current value from the slot:

```ts
const annSlot = userService.getSlotByKey(users, 'u1');
const effect = OIMEffectService.INSTANCE.createEffect(db, () => console.log(annSlot.entity?.name), [annSlot]);

annSlot.updateEntity({ name: 'Ann B.' });
annSlot.updateEntity({ email: 'ann@team.dev' });
db.flush();

OIMEffectService.INSTANCE.disposeEffect(effect);
```

Both writes are delivered in the one frame `db.flush()` runs, so the effect runs once for them.

### Indexes: Efficient Queries

#### An index that fills itself

An index is a collection of buckets over an entity collection. `selectKey` (or `columns`) is the index's key of an entity; `createIndexStoreSlot(users)` registers it on that store slot, and from then on every write files the entity into the bucket of its key. A bucket is minted on first read and filled from the entities already written.

```ts
const usersByTeamService = createOIMSlotCollectionIndexService({
    entityService: userService,
    selectKey: (user: User) => user.teamId,
});
const usersByTeam = usersByTeamService.createIndexStoreSlot(users);

const engineering = usersByTeamService.holdSlotByKey(usersByTeam, 'engineering');
OIMEffectService.INSTANCE.createEffect(db, () => console.log(engineering.getBucketMemberSlotCount()), [engineering]);

const engineers = usersByTeamService.getEntitiesByKey(usersByTeam, 'engineering');

const teamMembersService = createOIMSlotCollectionIndexService({
    entityService: userService,
    columns: ['teamId'],
    slotContentService: new OIMSetBucketContentService<TOIMEntitySlot<User>, string>(),
});
const teamMembers = teamMembersService.createIndexStoreSlot(users);
```

**Which bucket content:**
- **Positional array** (`OIMPositionalArrayBucketContentService`, the default): members in an array, with reads by position
- **Set** (`OIMSetBucketContentService`): membership without positions

With `columns`, a patch that moves none of the named columns keeps the entity's key and costs the index nothing; `selectKey` is read again on every write.

#### Buckets you order yourself

When the order is yours — a ranked list, a playlist — use a collection of buckets and write the member slots in the order you want. A bucket's slots are the caller's: a write to an entity files nothing into it.

```ts
const teamOrderService = createOIMSlotCollectionService({
    slotContentService: new OIMPositionalArrayBucketContentService<TOIMEntitySlot<User>>(),
});
const teamOrder = teamOrderService.createStoreSlot(db);

const engineeringOrder = teamOrderService.holdSlotByKey(teamOrder, 'engineering');
engineeringOrder.writeSlotContent([userService.getSlotByKey(users, 'u2'), userService.getSlotByKey(users, 'u1')]);
engineeringOrder.unholdSlot();
```

### Frames and Scheduling

An `OIMDB` built without a `channelScheduler` delivers nothing until `db.flush()` runs. Every write since the last flush lands in one frame: each effect runs at most once for it, and a write that moves no column wakes nobody.

Without an orchestrator, choose a scheduler at construction. A `TOIMChannelScheduler` is `(flush) => void`: the channel calls it on the first write of a frame, and it decides when `flush` runs:

```ts
const scheduledDb = new OIMDB({ channelScheduler: flush => queueMicrotask(flush) });
```

A microtask ends a frame at the first `await`, so a change that spans an `await` is delivered as two frames. Under CNStra the drain listener flushes, so the db needs no scheduler — see below; the server-sync binding commits the same way.

## Integration with CNStra

CNStra provides orchestration for OIMDB, replacing reducers, slices, thunks, and sagas with a typed neuron graph. Together, they deliver deterministic state management with high performance.

### Why CNStra + OIMDB?

**The Problem with Flux:**
- Multiple reducers need to coordinate ordering and cross-updates
- Immutable tree copies cause extra allocations and GC pressure
- No built-in "after everything settles" phase for batching

**Our Approach:**
- A controlling neuron orchestrates the sequence of updates across models
- OIMDB stores normalized data with self-filling indexes (no tree copies)
- CNStra calls a drain listener at the end of every synchronous turn of every stimulation; flushing there makes each turn exactly one OIMDB frame

### Minimal Setup

The whole connection is one line: `cns.addDrainListener(() => db.flush())`. Application code carries no `flush()` call anywhere.

```ts
const userRenamed = cnsCollateral<{ id: string; name: string }>();

const userModel = cnsNeuron({}).dendrite({
    collateral: userRenamed,
    response: ({ id, name }) => {
        userService.peekSlotByKey(users, id)?.updateEntity({ name });
    },
});

const cns = new CNS([userModel]);
cns.addDrainListener(() => db.flush());

cns.stimulate(userRenamed.createSignal({ id: 'u1', name: 'Ann B.' }));
```

A turn that awaits ends early, and the drain flushes what it wrote so far: a loading state written before an `await` is shown at once, and the data written after it arrives in the next frame.

**Every mutation goes through a domain neuron.** A write from a click handler, a socket callback or a timer is not flushed by anyone — route the event into a stimulation and let the neuron write.

### React Usage

`OIMDBProvider` carries the database; every hook takes the store slot it reads:

```tsx
function UserName({ id }: { id: string }) {
    const user = useOIMEntity(users, id);
    return <span>{user?.name ?? ''}</span>;
}

export const App = () => (
    <OIMDBProvider db={db}>
        <UserName id="u1" />
    </OIMDBProvider>
);
```

### Updating Multiple Collections

Best practice: each model is updated by its own domain neuron. The controller emits one controller-owned signal with both payloads; each domain neuron listens and updates its model.

```tsx
type Post = { id: string; title: string; authorId: string };

const postService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<Post>() });
const posts = postService.createStoreSlot(db);
const postsByAuthorService = createOIMSlotCollectionIndexService({
    entityService: postService,
    selectKey: (post: Post) => post.authorId,
});
const postsByAuthor = postsByAuthorService.createIndexStoreSlot(posts);

const userAndPostUpdated = cnsCollateral<{ user: User; post: Post }>();
const controllerUpdated = cnsCollateral<{ user: User; post: Post }>();

const controller = cnsNeuron({ controllerUpdated }).dendrite({
    collateral: userAndPostUpdated,
    response: (payload, axon) => axon.controllerUpdated.createSignal(payload),
});

const userModel = cnsNeuron({}).dendrite({
    collateral: controllerUpdated,
    response: ({ user }) => {
        userService.writeSlotContentByKey(users, user.id, user);
    },
});

const postModel = cnsNeuron({}).dendrite({
    collateral: controllerUpdated,
    response: ({ post }) => {
        postService.writeSlotContentByKey(posts, post.id, post);
    },
});

const cns = new CNS([controller, userModel, postModel]);
cns.addDrainListener(() => db.flush());

function AuthorWithPosts({ authorId }: { authorId: string }) {
    const author = useOIMEntity(users, authorId);
    const postSlots = useOIMBucketSlotsByKey(postsByAuthor, authorId);
    return (
        <section>
            <h4>{author?.name}</h4>
            <ul>{postSlots.map(slot => <li key={String(slot.key)}>{slot.entity?.title}</li>)}</ul>
        </section>
    );
}
```

Every response here is synchronous, so both writes land in one turn and one flush: `AuthorWithPosts` sees the author and the post in the same frame, not one write at a time. An index store slot fits `useOIMBucketSlotsByKey` as a bucket collection's store slot does.

### Example: Create Deck then Card

Goal: on UI click, create a deck first (to obtain `deckId`), then create a card that needs that `deckId`. A controlling neuron orchestrates; OIMDB keeps the models. The collections are shared by this example and the next one:

```ts setup shown
type Deck = { id: string; title: string };
type Card = { id: string; deckId: string; title: string };

const deckService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<Deck>() });
const decks = deckService.createStoreSlot(db);
const cardService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<Card>() });
const cards = cardService.createStoreSlot(db);
const cardsByDeckService = createOIMSlotCollectionIndexService({
    entityService: cardService,
    selectKey: (card: Card) => card.deckId,
});
const cardsByDeck = cardsByDeckService.createIndexStoreSlot(cards);

const generateDeckId = () => 'deck-' + Math.random().toString(36).slice(2);
const generateCardId = () => 'card-' + Math.random().toString(36).slice(2);
```

```ts
const uiCreateCardClick = cnsCollateral<{ deckTitle: string; cardTitle: string }>();
const controllerCreateDeckForCard = cnsCollateral<{ title: string; cardTitle: string }>();
const controllerCreateCard = cnsCollateral<{ deckId: string; title: string }>();
const deckCreatedForCard = cnsCollateral<{ deckId: string; cardTitle: string }>();

const deckNeuron = cnsNeuron({ deckCreatedForCard }).dendrite({
    collateral: controllerCreateDeckForCard,
    response: (payload, axon) => {
        const deckId = generateDeckId();
        deckService.writeSlotContentByKey(decks, deckId, { id: deckId, title: payload.title });
        return axon.deckCreatedForCard.createSignal({ deckId, cardTitle: payload.cardTitle });
    },
});

const cardNeuron = cnsNeuron({}).dendrite({
    collateral: controllerCreateCard,
    response: payload => {
        const cardId = generateCardId();
        cardService.writeSlotContentByKey(cards, cardId, { id: cardId, deckId: payload.deckId, title: payload.title });
    },
});

const controller = cnsNeuron({ controllerCreateDeckForCard, controllerCreateCard })
    .dendrite({
        collateral: uiCreateCardClick,
        response: (payload, axon) =>
            axon.controllerCreateDeckForCard.createSignal({ title: payload.deckTitle, cardTitle: payload.cardTitle }),
    })
    .dendrite({
        collateral: deckCreatedForCard,
        response: (payload, axon) =>
            axon.controllerCreateCard.createSignal({ deckId: payload.deckId, title: payload.cardTitle }),
    });

const cns = new CNS([controller, deckNeuron, cardNeuron]);
cns.addDrainListener(() => db.flush());

await cns.stimulate(uiCreateCardClick.createSignal({ deckTitle: 'Inbox', cardTitle: 'First task' })).waitUntilComplete();
```

The card title travels in the signal payloads, not in a context. The whole run is one synchronous turn, so the deck, the card and the `cardsByDeck` bucket arrive in one frame.

### Simplified Example: Direct Neuron Communication (No Controller)

For simpler flows, you can skip the controller and have neurons communicate directly:

```ts
const uiCreateCardClick = cnsCollateral<{ deckTitle: string; cardTitle: string }>();
const deckCreatedForCard = cnsCollateral<{ deckId: string; cardTitle: string }>();

const deckNeuron = cnsNeuron({ deckCreatedForCard }).dendrite({
    collateral: uiCreateCardClick,
    response: (payload, axon) => {
        const deckId = generateDeckId();
        deckService.writeSlotContentByKey(decks, deckId, { id: deckId, title: payload.deckTitle });
        return axon.deckCreatedForCard.createSignal({ deckId, cardTitle: payload.cardTitle });
    },
});

const cardNeuron = cnsNeuron({}).dendrite({
    collateral: deckCreatedForCard,
    response: payload => {
        const cardId = generateCardId();
        cardService.writeSlotContentByKey(cards, cardId, { id: cardId, deckId: payload.deckId, title: payload.cardTitle });
    },
});

const cns = new CNS([deckNeuron, cardNeuron]);
cns.addDrainListener(() => db.flush());

await cns.stimulate(uiCreateCardClick.createSignal({ deckTitle: 'Inbox', cardTitle: 'First task' })).waitUntilComplete();
```

**Rule of ownership:**
- A neuron emits only collaterals from its own axon
- Other neurons subscribe to those collaterals via dendrites
- In the controller example, the controller emits `controllerCreateDeckForCard` and `controllerCreateCard`; the deck neuron emits `deckCreatedForCard`; the card neuron writes data on `controllerCreateCard`

### Server Data: `@cnstra/oimdb`

To keep OIMDB collections equal to a server, `@cnstra/oimdb` binds the `@cnstra/sync` homeostat to OIMDB: a query is an OIMDB computed, its record lives in an OIMDB collection, and a domain collection can keep its read slots fresh while they are read. Start from `createCNSOIMDBHomeostatEnvironment({ db, cns })`; the full guide is [Sync (homeostat)](/docs/frontend/sync). It commits through the graph, like your own neurons: `cns.addDrainListener(() => db.flush())`.

## Performance Characteristics

- **Lookups**: one `Map` lookup per key in the default store
- **Indexes**: filed on write; a `writeInBatch` reaches each index in one call, which moves each group of entities with one bucket write
- **No-op writes**: a write that moves no column wakes nobody
- **Effects**: each runs at most once per flush, however many of its slots moved
- **Memory**: a slot nobody refers to is released; a read that mints a slot leaves it to the unused-slot collector unless something holds it

### Bucket Performance

**Positional array** (`OIMPositionalArrayBucketContentService`, the index default):
- Members in an array; `getBucketMemberSlotAt` is O(1)
- `getBucketMemberSlotPosition` walks the array, O(n)

**Set** (`OIMSetBucketContentService`):
- Membership without positions

## Integration with Other Libraries

### React (@oimdb/react)

Every hook that reads a collection by key takes the store slot alone:

- `useOIMEntity(entityStoreSlot, key)` — one entity
- `useOIMBucketSlotsByKey(bucketStoreSlot, key)` — one bucket's member slots; an index store slot fits too
- `useOIMField(entityCollectionService, slot, name)` — one column of a slot you hold
- `useOIMComputedValue(computedSlot)` — one derived value

### Redux (@oimdb/redux-adapter)

> **⚠️ Experimental**: The Redux adapter is experimental. Functionality is not guaranteed and the API may change.

Migrate from Redux to OIMDB gradually or use both systems side-by-side with automatic two-way synchronization. See [Redux Migration Guide](/docs/frontend/redux-migration) for details.

## API Reference

The doors this page uses. The full reference is the OIMDB documentation.

| Call | What it does |
|---|---|
| `new OIMDB({ channelScheduler? })` | the database; with no `channelScheduler`, nothing is delivered until `db.flush()` |
| `createOIMSlotCollectionService({ slotContentService })` | a collection type; `createOIMEntityContentService<TEntity>()` for entities, a bucket content service for buckets |
| `service.createStoreSlot(db)` | one instance of the collection |
| `service.writeSlotContentByKey(storeSlot, key, entity)` | the whole value under a key; returns the slot |
| `service.writeInBatch(storeSlot, write)` | a loop of writes that indexes hear in one call |
| `service.peekSlotByKey(storeSlot, key)` | the slot or `undefined`; mints nothing |
| `service.getSlotByKey(storeSlot, key)` / `holdSlotByKey` | the slot, minted if missing; `holdSlotByKey` also holds it until `unholdSlot()` |
| `slot.updateEntity(patch)` / `slot.clearSlotContent()` | patch the entity / remove it |
| `createOIMSlotCollectionIndexService({ entityService, selectKey })` | an index type; `columns` instead of or alongside `selectKey`, and an optional `slotContentService` |
| `indexService.createIndexStoreSlot(entityStoreSlot)` | the index over one collection instance |
| `indexService.getEntitiesByKey(indexStoreSlot, key)` | the entities in one bucket |
| `OIMEffectService.INSTANCE.createEffect(db, body, sourceSlots)` / `disposeEffect(effect)` | run `body` when a source slot moves / stop |
| `cns.addDrainListener(() => db.flush())` | one OIMDB frame per CNStra turn |

## License

MIT License
