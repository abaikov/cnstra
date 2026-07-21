---
id: oimdb
title: React State Management with CNStra & OIMDB - Redux Alternative
sidebar_label: CNStra & OIMDB
slug: /frontend/oimdb
description: Learn how CNStra + OIMDB provides deterministic React state management. A performant alternative to Redux, MobX, Zustand. Type-safe, derived state, reactive updates, SOLID/SRP by design. Perfect for complex React applications.
keywords: [React state management, Redux alternative, MobX alternative, Zustand alternative, Recoil alternative, Jotai alternative, React hooks, derived state, reactive state, OIMDB, in-memory database, frontend orchestration, React best practices, type-safe React state, deterministic React, performance optimization, state synchronization, React state machine]
---

# OIMDB: Reactive In-Memory Database for JavaScript

OIMDB (Object In-Memory Database) is a reactive in-memory database library that provides normalized entity storage, intelligent indexing, and automatic change notifications. Unlike traditional state managers that copy entire state trees, OIMDB uses O(1) Map-based lookups and efficient event coalescing to deliver high-performance state management.

## Why OIMDB?

Traditional state management approaches like Redux or MobX have limitations:

- **Tree copying overhead**: Immutable updates require copying large state trees, causing GC pressure
- **No built-in indexing**: Querying related data requires manual filtering or memoization
- **Fragile batching**: UI updates are batched inconsistently across frameworks
- **Complex coordination**: Multiple reducers need ad-hoc messaging to coordinate updates

OIMDB solves these problems with:

- **Normalized storage**: Entities stored by primary key in Maps (O(1) lookups)
- **Reactive indexes**: Set- and array-based indexes for efficient queries (e.g., "all posts by author")
- **Event coalescing**: Multiple rapid updates to the same entity trigger only one notification
- **Configurable scheduling**: Choose when events fire (microtask, animationFrame, timeout, immediate)

## Installation

```bash
npm install @oimdb/core
```

## Core Concepts

### Collections: Normalized Entity Storage

The canonical entry point is `createOIMCollectionKit`. It wires a collection to an event queue and returns a kit with everything you need — `collection` (reads/writes/subscriptions), `indexFactory` (build indexes), and `select` (selectors). Entities are stored by primary key, providing O(1) lookups:

```typescript
import {
    OIMEventQueue,
    OIMEventQueueSchedulerFactory,
    createOIMCollectionKit,
} from '@oimdb/core';

interface User {
    id: string;
    name: string;
    email: string;
}

// Create event queue with microtask scheduler (most common)
const queue = new OIMEventQueue({
    scheduler: OIMEventQueueSchedulerFactory.createMicrotask()
});

// Create a collection kit
const users = createOIMCollectionKit<User, string>(queue, {
    selectPk: (user) => user.id
});

// CRUD operations go through users.collection
users.collection.upsertOne({ id: 'user1', name: 'John Doe', email: 'john@example.com' });
users.collection.upsertMany([
    { id: 'user2', name: 'Jane Smith', email: 'jane@example.com' },
    { id: 'user3', name: 'Bob Wilson', email: 'bob@example.com' }
]);

// O(1) lookups
const user = users.collection.getOneByPk('user1');
const multipleUsers = users.collection.getManyByPks(['user1', 'user2']);
```

### Reactive Updates: Key-Specific Subscriptions

Subscribe directly on the collection to changes for specific entities. Handlers receive no payload — read the current value from the collection when they fire:

```typescript
// Subscribe to changes for a specific user
users.collection.subscribeOnKey('user1', () => {
    console.log('User1 changed!', users.collection.getOneByPk('user1'));
});

// Subscribe to changes for multiple users
users.collection.subscribeOnKeys(['user1', 'user2'], () => {
    console.log('Users changed!');
});

// Updates trigger notifications
users.collection.upsertOne({ id: 'user1', name: 'John Updated' });
// Notification fires in next microtask
```

### Indexes: Efficient Queries

Indexes are created through the kit's `indexFactory`. OIMDB provides two manual index types optimized for different use cases, plus **derived** indexes that maintain themselves from an entity field.

#### SetBased Indexes: For Incremental Updates

Use when you frequently add/remove individual items:

```typescript
// Create a manual Set-based index for user roles
const userRoleIndex = users.indexFactory.setBasedIndex<string>();

// Build the index
userRoleIndex.setPks('admin', ['user1']);
userRoleIndex.setPks('user', ['user2', 'user3']);

// Efficient incremental updates
userRoleIndex.addPks('admin', ['user2']); // O(1)
userRoleIndex.removePks('admin', ['user1']); // O(1)

// Query returns Set<TPk>
const adminUsers = userRoleIndex.getPksByKey('admin'); // Set(['user2'])

// Subscribe to a specific index key
userRoleIndex.subscribeOnKey('admin', () => {
    console.log('Admins changed:', userRoleIndex.getPksByKey('admin'));
});
```

#### ArrayBased Indexes: For Full Replacements

Use when you typically replace entire arrays (e.g., ordered lists):

```typescript
// Create a manual Array-based index for deck cards
const cardsByDeckIndex = cards.indexFactory.arrayBasedIndex<string>();

// Set full array (O(1) - direct assignment, no diff computation)
cardsByDeckIndex.setPks('deck1', ['card1', 'card2', 'card3']);

// Query returns TPk[]
const deckCards = cardsByDeckIndex.getPksByKey('deck1'); // ['card1', 'card2', 'card3']

// For ArrayBased, prefer setPks for updates
cardsByDeckIndex.setPks('deck1', ['card1', 'card2', 'card4']); // Recommended
// addPks/removePks work but are O(n) - less efficient than SetBased
```

**When to use which:**
- **SetBased**: Frequent add/remove operations, order doesn't matter
- **ArrayBased**: Full array replacements, need to preserve order/sorting

#### Derived Indexes: Maintained Automatically

When the index key is a field of the entity, use a derived index — it updates itself on every upsert/remove, so you never call `setPks` manually:

```typescript
// Automatically groups users by their `teamId` field
const usersByTeam = users.indexFactory.derivedSetIndex((user) => user.teamId);

// Query returns Set<TPk>, always in sync with the collection
const engineering = usersByTeam.getPksByKey('engineering');
```

### Event Coalescing: Performance Optimization

Multiple rapid updates to the same entity are automatically coalesced into a single notification:

```typescript
// These three updates...
users.collection.upsertOne({ id: 'user1', name: 'John' });
users.collection.upsertOne({ id: 'user1', email: 'john@test.com' });
users.collection.upsertOne({ id: 'user1', name: 'John Doe' });

// ...result in only one notification with the final state
// This prevents unnecessary re-renders and improves performance
```

### Event Queue and Schedulers

Control when events fire with different schedulers:

```typescript
// Microtask (most common) - executes before next browser render
const microtaskQueue = new OIMEventQueue({
    scheduler: OIMEventQueueSchedulerFactory.createMicrotask()
});

// AnimationFrame - syncs with browser rendering (60fps)
const animationFrameQueue = new OIMEventQueue({
    scheduler: OIMEventQueueSchedulerFactory.createAnimationFrame()
});

// Timeout - configurable delay for custom batching
const timeoutQueue = new OIMEventQueue({
    scheduler: OIMEventQueueSchedulerFactory.createTimeout(100)
});

// Immediate - fastest execution
const immediateQueue = new OIMEventQueue({
    scheduler: OIMEventQueueSchedulerFactory.createImmediate()
});

// Manual queue (no scheduler)
const manualQueue = new OIMEventQueue();
manualQueue.enqueue(() => console.log('Task 1'));
manualQueue.flush(); // Execute when ready
```

## Advanced Patterns

### Collections with Indexes

A kit already exposes `indexFactory` — create as many indexes as you need and keep references to them:

```typescript
import {
    OIMEventQueue,
    OIMEventQueueSchedulerFactory,
    createOIMCollectionKit,
} from '@oimdb/core';

interface User {
    id: string;
    name: string;
    teamId: string;
    role: 'admin' | 'user';
}

const queue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });

// Create the collection kit
const users = createOIMCollectionKit<User, string>(queue, {
    selectPk: (user) => user.id,
});

// Derived index: auto-maintained from the `teamId` field
const usersByTeam = users.indexFactory.derivedSetIndex((user) => user.teamId);
// Manual index: you control membership explicitly
const usersByRole = users.indexFactory.setBasedIndex<string>();

// Subscribe to index changes
usersByTeam.subscribeOnKey('engineering', () => {
    console.log('Engineering team changed:', usersByTeam.getPksByKey('engineering'));
});

// Writing entities keeps the derived index in sync automatically
users.collection.upsertMany([
    { id: 'u1', name: 'Ann', teamId: 'engineering', role: 'admin' },
    { id: 'u2', name: 'Bob', teamId: 'engineering', role: 'user' },
]);

// Manual index is updated by hand
usersByRole.setPks('admin', ['u1']);
```

### Custom Entity Updaters

By default an upsert replaces the stored entity. To merge instead, pass an `updateEntity` updater. OIMDB ships factories for the common cases, and you can supply your own `(draft, prevEntity) => entity`:

```typescript
import { createOIMCollectionKit, createMergeEntityUpdater } from '@oimdb/core';

// Built-in shallow merge: partial upserts merge into the existing entity
const users = createOIMCollectionKit<User, string>(queue, {
    selectPk: (user) => user.id,
    updateEntity: createMergeEntityUpdater<User>(),
});

// Updates merge with existing
users.collection.upsertOne({ id: 'user1', name: 'John' });
users.collection.upsertOneByPk('user1', { email: 'john@example.com' }); // merges

// Or a custom updater, e.g. a deep merge
const deepMerge: (draft: Partial<User>, prev: User) => User = (draft, prev) => {
    const result = { ...prev };
    for (const [key, value] of Object.entries(draft)) {
        if (value !== undefined) {
            (result as any)[key] = value;
        }
    }
    return result;
};

const usersDeep = createOIMCollectionKit<User, string>(queue, {
    selectPk: (user) => user.id,
    updateEntity: deepMerge,
});
```

## Integration with CNStra

CNStra provides orchestration for OIMDB, replacing reducers, slices, thunks, and sagas with a typed neuron graph. Together, they deliver deterministic state management with high performance.

### Why CNStra + OIMDB?

**The Problem with Flux:**
- Multiple reducers need to coordinate ordering and cross-updates
- Immutable tree copies cause extra allocations and GC pressure
- No built-in "after everything settles" phase for batching

**Our Approach:**
- A controlling neuron orchestrates the sequence of updates across models
- OIMDB stores normalized data with reactive indexes (no tree copies)
- After all model updates in a run, we flush the OIMDB event queue once, so the UI updates efficiently in batches

### Minimal Setup

```ts
import { CNS, neuron, collateral } from '@cnstra/core';
import { OIMEventQueue, OIMEventQueueSchedulerFactory, createOIMCollectionKit } from '@oimdb/core';

const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const users = createOIMCollectionKit<{ id: string; name: string }, string>(dbEventQueue, {
  selectPk: (u) => u.id,
});

// Define UI/update collateral
const userUpdated = collateral<{ id: string; name: string }>();

// Controlling neuron updates models and returns nothing (end of branch)
export const usersNeuron = neuron({}).dendrite({
  collateral: userUpdated,
  response: (payload) => {
    users.collection.upsertOne({ id: payload.id, name: payload.name });
    // OIMDB event queue will flush after the run completes
    return undefined;
  },
});

const cns = new CNS([usersNeuron]);
```

### React Usage

React hooks take the **reactive collection** (`users.collection`), not the kit:

```tsx
import { useSelectEntityByPk } from '@oimdb/react';

function UserName({ id }: { id: string }) {
  const user = useSelectEntityByPk(users.collection, id) || null;
  return <span>{user?.name ?? ''}</span>;
}
```

### Updating Multiple Collections

Best practice: each model is updated by its own domain neuron. The controller emits one controller-owned signal with both payloads; each domain neuron listens and updates its model.

```ts
import { collateral, neuron } from '@cnstra/core';
import { OIMEventQueue, OIMEventQueueSchedulerFactory, createOIMCollectionKit } from '@oimdb/core';

type UserEntity = { id: string; name: string };
type PostEntity = { id: string; title: string; authorId: string };

const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const users = createOIMCollectionKit<UserEntity, string>(dbEventQueue, {
  selectPk: (u) => u.id,
});
export const posts = createOIMCollectionKit<PostEntity, string>(dbEventQueue, {
  selectPk: (p) => p.id,
});
// Derived index: posts grouped by author, kept in sync automatically
export const postsByAuthor = posts.indexFactory.derivedSetIndex((p) => p.authorId);

// Single incoming signal with both payloads
const userAndPostUpdated = collateral<{
  user: UserEntity;
  post: PostEntity;
}>();

// Controller-owned single update signal
const controllerUpdated = collateral<{
  user: UserEntity;
  post: PostEntity;
}>();

// Controller receives inbound and emits one outbound
export const controller = neuron({ controllerUpdated })
  .dendrite({
    collateral: userAndPostUpdated,
    response: (payload, axon) => axon.controllerUpdated.createSignal(payload),
  });

// Domain neurons update their own collections
export const userModel = neuron({}).dendrite({
  collateral: controllerUpdated,
  response: (p) => {
    users.collection.upsertOne(p.user);
    return undefined;
  },
});

export const postModel = neuron({}).dendrite({
  collateral: controllerUpdated,
  response: (p) => {
    posts.collection.upsertOne(p.post);
    return undefined;
  },
});
```

React selectors will observe a single batched change after the run completes, not N re-renders during the sequence. Index hooks take the **index object** (not a string name):

```tsx
import { useSelectEntityByPk, useSelectEntitiesByIndexKeySetBased } from '@oimdb/react';

function AuthorWithPosts({ authorId }: { authorId: string }) {
  const user = useSelectEntityByPk(users.collection, authorId) || null;
  const postsByAuthorList =
    useSelectEntitiesByIndexKeySetBased(posts.collection, postsByAuthor, authorId) ?? [];
  return (
    <section>
      <h4>{user?.name}</h4>
      <ul>{postsByAuthorList.map(p => p && <li key={p.id}>{p.title}</li>)}</ul>
    </section>
  );
}
```

### Example: Create Deck then Card

Goal: on UI click, create a deck first (to obtain `deckId`), then create a card that needs that `deckId`. We orchestrate this with a controlling neuron; OIMDB persists models; the event queue flushes once after the run.

```ts
import { CNS, collateral, neuron } from '@cnstra/core';
import {
  OIMEventQueue,
  OIMEventQueueSchedulerFactory,
  createOIMCollectionKit,
} from '@oimdb/core';

type DeckEntity = { id: string; title: string };
type CardEntity = { id: string; deckId: string; title: string };

// OIMDB setup
const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const decks = createOIMCollectionKit<DeckEntity, string>(dbEventQueue, {
  selectPk: (d) => d.id,
});
export const cards = createOIMCollectionKit<CardEntity, string>(dbEventQueue, {
  selectPk: (c) => c.id,
});
// Cards grouped by deck, maintained automatically
export const cardsByDeck = cards.indexFactory.derivedSetIndex((c) => c.deckId);

// Collaterals
const uiCreateCardClick = collateral<{ deckTitle: string; cardTitle: string }>();
const controllerCreateDeckForCard = collateral<{ title: string; cardTitle: string }>();
const controllerCreateCard = collateral<{ deckId: string; title: string }>();
const deckCreatedForCard = collateral<{ deckId: string; title: string; cardTitle: string }>();

// Services (mocked)
const generateDeckId = () => 'deck-' + Math.random().toString(36).slice(2);
const generateCardId = () => 'card-' + Math.random().toString(36).slice(2);

// Deck neuron: listens controller:deck:createForCard, emits deck:createdForCard, upserts OIMDB
export const deckNeuron = neuron({ deckCreatedForCard }).dendrite({
  collateral: controllerCreateDeckForCard,
  response: async (payload, axon) => {
    const deckId = generateDeckId();
    decks.collection.upsertOne({ id: deckId, title: payload.title });
    return axon.deckCreatedForCard.createSignal({ deckId, title: payload.title, cardTitle: payload.cardTitle });
  },
});

// Card neuron: listens controller:card:create, upserts OIMDB
export const cardNeuron = neuron({}).dendrite({
  collateral: controllerCreateCard,
  response: async (payload) => {
    const cardId = generateCardId();
    cards.collection.upsertOne({ id: cardId, deckId: payload.deckId, title: payload.title });
    return undefined;
  },
});

// Controller neuron: emits only its own collaterals (controller:*)
// Pass cardTitle through signal payloads, not context
export const controller = neuron({ controllerCreateDeckForCard, controllerCreateCard })
  .dendrite({
    collateral: uiCreateCardClick,
    response: (payload, axon) => {
      // Pass cardTitle along with deck creation through payload
      return axon.controllerCreateDeckForCard.createSignal({
        title: payload.deckTitle,
        cardTitle: payload.cardTitle
      });
    },
  })
  .dendrite({
    collateral: deckCreatedForCard,
    response: (payload, axon) => {
      return axon.controllerCreateCard.createSignal({ deckId: payload.deckId, title: payload.cardTitle });
    },
  });

// CNS
const cns = new CNS([controller, deckNeuron, cardNeuron]);

// UI click starts the run; OIMDB event queue flushes once after both upserts
await cns.stimulate(uiCreateCardClick.createSignal({ deckTitle: 'Inbox', cardTitle: 'First task' }));
```

### Simplified Example: Direct Neuron Communication (No Controller)

For simpler flows, you can skip the controller and have neurons communicate directly:

```ts
import { CNS, collateral, neuron } from '@cnstra/core';
import {
  OIMEventQueue,
  OIMEventQueueSchedulerFactory,
  createOIMCollectionKit,
} from '@oimdb/core';

type DeckEntity = { id: string; title: string };
type CardEntity = { id: string; deckId: string; title: string };

// OIMDB setup
const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const decks = createOIMCollectionKit<DeckEntity, string>(dbEventQueue, {
  selectPk: (d) => d.id,
});
export const cards = createOIMCollectionKit<CardEntity, string>(dbEventQueue, {
  selectPk: (c) => c.id,
});

// Collaterals
const uiCreateCardClick = collateral<{ deckTitle: string; cardTitle: string }>();
const deckCreatedForCard = collateral<{ deckId: string; cardTitle: string }>();

// Services (mocked)
const generateDeckId = () => 'deck-' + Math.random().toString(36).slice(2);
const generateCardId = () => 'card-' + Math.random().toString(36).slice(2);

// Deck neuron: listens to UI click, creates deck, emits deckCreatedForCard
export const deckNeuron = neuron({ deckCreatedForCard }).dendrite({
  collateral: uiCreateCardClick,
  response: async (payload, axon) => {
    const deckId = generateDeckId();
    decks.collection.upsertOne({ id: deckId, title: payload.deckTitle });
    return axon.deckCreatedForCard.createSignal({ deckId, cardTitle: payload.cardTitle });
  },
});

// Card neuron: listens to deckCreatedForCard, creates card
export const cardNeuron = neuron({}).dendrite({
  collateral: deckCreatedForCard,
  response: async (payload) => {
    const cardId = generateCardId();
    cards.collection.upsertOne({ id: cardId, deckId: payload.deckId, title: payload.cardTitle });
    return undefined;
  },
});

// CNS (no controller needed)
const cns = new CNS([deckNeuron, cardNeuron]);

// UI click starts the run; OIMDB event queue flushes once after both upserts
await cns.stimulate(uiCreateCardClick.createSignal({ deckTitle: 'Inbox', cardTitle: 'First task' }));
```

**Rule of ownership:**
- A neuron emits only collaterals from its own axon
- Other neurons subscribe to those collaterals via dendrites
- In this example, controller emits `controller:*` requests; deck emits `deck:createdForCard`; card writes data on `controller:card:create`

## Performance Characteristics

- **Collections**: O(1) primary key lookups using Map-based storage
- **Reactive Collections**: O(1) lookups + efficient event coalescing
- **Indices**: O(1) index lookups with lazy evaluation
- **Event System**: Smart coalescing prevents redundant notifications
- **Memory**: Efficient key-based subscriptions, no global listeners
- **Schedulers**: Configurable timing for optimal batching:
  - **Microtask**: ~1-5ms delay, ideal for UI updates
  - **Immediate**: &lt;1ms, fastest execution  
  - **Timeout**: Custom delay for batching strategies
  - **AnimationFrame**: 16ms, synced with 60fps rendering

### Index Performance

**SetBased Indexes** (`indexFactory.setBasedIndex()` / `derivedSetIndex()`):
- Returns `Set<TPk>` for efficient membership checks
- O(1) add/remove operations
- Best for frequent incremental updates

**ArrayBased Indexes** (`indexFactory.arrayBasedIndex()` / `derivedArrayIndex()`):
- Returns `TPk[]` for direct array access
- O(1) `setPks` operation (direct assignment, no diff computation)
- Best for full array replacements
- Note: `addPks`/`removePks` are O(n) - prefer `setPks` for better performance

## Integration with Other Libraries

### React (@oimdb/react)

The core library integrates seamlessly with React through dedicated hooks. All hooks take the **reactive collection** (`kit.collection`) and, for index queries, the **index object**:

```typescript
import { useSelectEntityByPk, useSelectEntitiesByPks } from '@oimdb/react';

// Single entity by primary key
const user = useSelectEntityByPk(users.collection, 'user1');
// Many entities by primary keys
const teamUsers = useSelectEntitiesByPks(users.collection, userIds);
```

### Redux (@oimdb/redux-adapter)

> **⚠️ Experimental**: The Redux adapter is experimental. Functionality is not guaranteed and the API may change.

Migrate from Redux to OIMDB gradually or use both systems side-by-side with automatic two-way synchronization. See [Redux Migration Guide](/docs/frontend/redux-migration) for details.

## API Reference

### Collection Kit

#### `createOIMCollectionKit<TEntity, TPk>(queue, opts?)`

Creates a reactive collection and returns a kit:

```typescript
const kit = createOIMCollectionKit<TEntity, TPk>(queue: OIMEventQueue, opts?: {
    selectPk?: (entity: TEntity) => TPk;
    updateEntity?: (draft: Partial<TEntity>, prevEntity: TEntity) => TEntity;
});
// kit = { queue, collection, indexFactory, select }
```

#### `kit.collection` — `OIMReactiveCollection<TEntity, TPk>`

Reactive collection with automatic change notifications and event coalescing.

**Key Methods:**
- `upsertOne(entity): TOIMEntitySlot` - Insert or update a single entity
- `upsertOneByPk(pk, partial): TOIMEntitySlot` - Insert or update by primary key
- `upsertMany(entities): TOIMEntitySlot[]` - Insert or update multiple entities
- `removeOneByPk(pk): void` / `removeManyByPks(pks): void` - Remove entities
- `getOneByPk(pk): TEntity | undefined` - Get entity by primary key
- `getManyByPks(pks): TEntity[]` - Get multiple entities
- `getAll(): TEntity[]` - Get all entities
- `subscribeOnKey(pk, handler): () => void` - Subscribe to a single key (handler takes no args)
- `subscribeOnKeys(pks, handler): () => void` - Subscribe to multiple keys

#### `kit.indexFactory` — `OIMCollectionIndexFactory<TEntity, TPk>`

Builds indexes bound to the collection:

- `setBasedIndex<TKey>(): OIMReactiveCollectionIndexManualSetBased` - Manual Set-based index
- `arrayBasedIndex<TKey>(): OIMReactiveCollectionIndexManualArrayBased` - Manual Array-based index
- `derivedSetIndex<TKey>(selectKey): OIMDerivedCollectionIndexSetBased` - Auto-maintained Set index
- `derivedArrayIndex<TKey>(selectKey): OIMDerivedCollectionIndexArrayBased` - Auto-maintained Array index

**Index methods** (on the returned index):
- `getPksByKey(key): Set<TPk> | TPk[]` - Query the index
- `subscribeOnKey(key, handler): () => void` - Subscribe to a key
- Manual indexes only: `setPks(key, pks)`, `addPks(key, pks)`, `removePks(key, pks)`, `clear(key?)`

#### `kit.select` — `OIMCollectionSelectors<TEntity, TPk>`

Composable selectors (each has a `.watch(cb)` method):
- `byPk(pk)` / `byPks(pks)`
- `entitiesBySetIndexKey(index, key)` / `entitiesByArrayIndexKey(index, key)`

### `OIMEventQueue`

Event processing queue with configurable scheduling.

**Constructor:**
```typescript
new OIMEventQueue(options?: TOIMEventQueueOptions)
```

**Methods:**
- `enqueue(fn: () => void): void` - Add function to queue
- `flush(): void` - Execute all queued functions
- `clear(): void` - Clear queue without executing

### Schedulers

#### `OIMEventQueueSchedulerFactory`

Factory for creating different scheduler types:

```typescript
OIMEventQueueSchedulerFactory.createMicrotask()
OIMEventQueueSchedulerFactory.createAnimationFrame()
OIMEventQueueSchedulerFactory.createTimeout(delay?: number)
OIMEventQueueSchedulerFactory.createImmediate()
```

## License

MIT License
