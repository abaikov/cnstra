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
- **Reactive indexes**: Manual indexes for efficient queries (e.g., "all posts by author")
- **Event coalescing**: Multiple rapid updates to the same entity trigger only one notification
- **Configurable scheduling**: Choose when events fire (microtask, animationFrame, timeout, immediate)

## Installation

```bash
npm install @oimdb/core
```

## Core Concepts

### Collections: Normalized Entity Storage

Collections store entities by primary key, providing O(1) lookups:

```typescript
import { 
    OIMReactiveCollection, 
    OIMEventQueue,
    OIMEventQueueSchedulerFactory
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

// Create reactive collection
const users = new OIMReactiveCollection<User, string>(queue, {
    selectPk: (user) => user.id
});

// CRUD operations
users.upsertOne({ id: 'user1', name: 'John Doe', email: 'john@example.com' });
users.upsertMany([
    { id: 'user2', name: 'Jane Smith', email: 'jane@example.com' },
    { id: 'user3', name: 'Bob Wilson', email: 'bob@example.com' }
]);

// O(1) lookups
const user = users.getOneByPk('user1');
const multipleUsers = users.getManyByPks(['user1', 'user2']);
```

### Reactive Updates: Key-Specific Subscriptions

Subscribe to changes for specific entities:

```typescript
// Subscribe to changes for a specific user
users.updateEventEmitter.subscribeOnKey('user1', () => {
    console.log('User1 changed!');
});

// Subscribe to changes for multiple users
users.updateEventEmitter.subscribeOnKeys(['user1', 'user2'], () => {
    console.log('Users changed!');
});

// Updates trigger notifications
users.upsertOne({ id: 'user1', name: 'John Updated' });
// Notification fires in next microtask
```

### Indexes: Efficient Queries

OIMDB provides two index types optimized for different use cases:

#### SetBased Indexes: For Incremental Updates

Use when you frequently add/remove individual items:

```typescript
import { OIMReactiveIndexManualSetBased } from '@oimdb/core';

// Create Set-based index for user roles
const userRoleIndex = new OIMReactiveIndexManualSetBased<string, string>(queue);

// Build the index
userRoleIndex.setPks('admin', ['user1']);
userRoleIndex.setPks('user', ['user2', 'user3']);

// Efficient incremental updates
userRoleIndex.addPks('admin', ['user2']); // O(1)
userRoleIndex.removePks('admin', ['user1']); // O(1)

// Query returns Set<TPk>
const adminUsers = userRoleIndex.index.getPksByKey('admin'); // Set(['user1', 'user2'])
```

#### ArrayBased Indexes: For Full Replacements

Use when you typically replace entire arrays (e.g., ordered lists):

```typescript
import { OIMReactiveIndexManualArrayBased } from '@oimdb/core';

// Create Array-based index for deck cards
const cardsByDeckIndex = new OIMReactiveIndexManualArrayBased<string, string>(queue);

// Set full array (O(1) - direct assignment, no diff computation)
cardsByDeckIndex.setPks('deck1', ['card1', 'card2', 'card3']);

// Query returns TPk[]
const deckCards = cardsByDeckIndex.index.getPksByKey('deck1'); // ['card1', 'card2', 'card3']

// For ArrayBased, prefer setPks for updates
cardsByDeckIndex.setPks('deck1', ['card1', 'card2', 'card4']); // Recommended
// addPks/removePks work but are O(n) - less efficient than SetBased
```

**When to use which:**
- **SetBased**: Frequent add/remove operations, order doesn't matter
- **ArrayBased**: Full array replacements, need to preserve order/sorting

### Event Coalescing: Performance Optimization

Multiple rapid updates to the same entity are automatically coalesced into a single notification:

```typescript
// These three updates...
users.upsertOne({ id: 'user1', name: 'John' });
users.upsertOne({ id: 'user1', email: 'john@test.com' });
users.upsertOne({ id: 'user1', role: 'admin' });

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

Use `OIMRICollection` to combine collections with indexes:

```typescript
import { 
    OIMRICollection, 
    OIMReactiveIndexManualSetBased,
    OIMReactiveIndexManualArrayBased
} from '@oimdb/core';

interface User {
    id: string;
    name: string;
    teamId: string;
    role: 'admin' | 'user';
}

// Create indexes
const teamIndex = new OIMReactiveIndexManualSetBased<string, string>(queue);
const roleIndex = new OIMReactiveIndexManualArrayBased<string, string>(queue);

// Create collection with indexes
const users = new OIMRICollection(queue, {
    collectionOpts: {
        selectPk: (user: User) => user.id
    },
    indexes: {
        byTeam: teamIndex,
        byRole: roleIndex
    }
});

// Subscribe to index changes
users.indexes.byTeam.updateEventEmitter.subscribeOnKey('engineering', (pks) => {
    console.log('Engineering team changed:', pks);
});

// Update indexes manually
users.indexes.byTeam.setPks('engineering', ['u1', 'u2']);
```

### Custom Entity Updaters

Customize how entities are merged on update:

```typescript
import { TOIMEntityUpdater } from '@oimdb/core';

// Deep merge updater
const deepMergeUpdater: TOIMEntityUpdater<User> = (newEntity, oldEntity) => {
    const result = { ...oldEntity };
    
    for (const [key, value] of Object.entries(newEntity)) {
        if (value !== undefined) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result[key] = deepMergeUpdater(value, result[key] || {});
            } else {
                result[key] = value;
            }
        }
    }
    
    return result;
};

// Use custom updater
const users = new OIMReactiveCollection<User, string>(queue, {
    selectPk: (user) => user.id,
    updateEntity: deepMergeUpdater
});

// Updates merge with existing
users.upsertOne({ id: 'user1', name: 'John' });
users.upsertOne({ id: 'user1', email: 'john@example.com' }); // Merges with existing
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
import { OIMEventQueue, OIMEventQueueSchedulerFactory, OIMRICollection, OIMReactiveIndexManualSetBased } from '@oimdb/core';

const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const users = new OIMRICollection(dbEventQueue, {
  indexes: { byId: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (u: { id: string }) => u.id }
});

// Define UI/update collateral
const userUpdated = collateral<{ id: string; name: string }>('user:updated');

// Controlling neuron updates models and returns nothing (end of branch)
export const usersNeuron = neuron('users', {}).dendrite({
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

```tsx
import { useSelectEntityByPk } from '@oimdb/react';

function UserName({ id }: { id: string }) {
  const user = useSelectEntityByPk(users, id) || null;
  return <span>{user?.name ?? ''}</span>;
}
```

### Updating Multiple Collections

Best practice: each model is updated by its own domain neuron. The controller emits one controller-owned signal with both payloads; each domain neuron listens and updates its model.

```ts
import { collateral, neuron } from '@cnstra/core';
import { OIMEventQueue, OIMEventQueueSchedulerFactory, OIMRICollection, OIMReactiveIndexManualSetBased } from '@oimdb/core';

const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const users = new OIMRICollection(dbEventQueue, {
  indexes: { byId: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (u: { id: string }) => u.id },
});
export const posts = new OIMRICollection(dbEventQueue, {
  indexes: { byAuthor: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (p: { id: string }) => p.id },
});

// Single incoming signal with both payloads
const userAndPostUpdated = collateral<{
  user: { id: string; name: string };
  post: { id: string; title: string; authorId: string };
}>('user+post:updated');

// Controller-owned single update signal
const controllerUpdated = collateral<{
  user: { id: string; name: string };
  post: { id: string; title: string; authorId: string };
}>('controller:updated');

// Controller receives inbound and emits one outbound
export const controller = neuron('controller', { controllerUpdated })
  .dendrite({
    collateral: userAndPostUpdated,
    response: (payload, axon) => axon.controllerUpdated.createSignal(payload),
  });

// Domain neurons update their own collections
export const userModel = neuron('user-model', {}).dendrite({
  collateral: controllerUpdated,
  response: (p) => {
    users.collection.upsertOne(p.user);
    return undefined;
  },
});

export const postModel = neuron('post-model', {}).dendrite({
  collateral: controllerUpdated,
  response: (p) => {
    posts.collection.upsertOne(p.post);
    return undefined;
  },
});
```

React selectors will observe a single batched change after the run completes, not N re-renders during the sequence.

```tsx
import { useSelectEntityByPk, useSelectEntitiesByIndexKey } from '@oimdb/react';

function AuthorWithPosts({ authorId }: { authorId: string }) {
  const user = useSelectEntityByPk(users, authorId) || null;
  const postsByAuthor = useSelectEntitiesByIndexKey(posts, 'byAuthor', authorId) || [];
  return (
    <section>
      <h4>{user?.name}</h4>
      <ul>{postsByAuthor.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </section>
  );
}
```

### Example: Create Deck then Card

Goal: on UI click, create a deck first (to obtain `deckId`), then create a card that needs that `deckId`. We orchestrate this with a controlling neuron; OIMDB persists models; the event queue flushes once after the run.

```ts
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import {
  OIMEventQueue,
  OIMEventQueueSchedulerFactory,
  OIMRICollection,
  OIMReactiveIndexManualSetBased,
} from '@oimdb/core';

// OIMDB setup
const dbEventQueue = new OIMEventQueue({ scheduler: OIMEventQueueSchedulerFactory.createMicrotask() });
export const decks = new OIMRICollection(dbEventQueue, {
  indexes: { byId: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (d: { id: string }) => d.id },
});
export const cards = new OIMRICollection(dbEventQueue, {
  indexes: { byDeck: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (c: { id: string }) => c.id },
});

// Collaterals
const uiCreateCardClick = collateral<{ deckTitle: string; cardTitle: string }>('ui:createCardClick');
const controllerCreateDeckForCard = collateral<{ title: string; cardTitle: string }>('controller:deck:createForCard');
const controllerCreateCard = collateral<{ deckId: string; cardId: string; title: string }>('controller:card:create');
const deckCreatedForCard = collateral<{ deckId: string; title: string; cardTitle: string }>('deck:createdForCard');

// Services (mocked)
const deckService = { create: async (title: string) => 'deck-' + Math.random().toString(36).slice(2) };
const id = () => 'card-' + Math.random().toString(36).slice(2);

// Deck neuron: listens controller:deck:createForCard, emits deck:createdForCard, upserts OIMDB
export const deckNeuron = neuron('deck', { deckCreatedForCard }).dendrite({
  collateral: controllerCreateDeckForCard,
  response: async (payload, axon) => {
    const deckId = await deckService.create(payload.title);
    decks.collection.upsertOne({ id: deckId, title: payload.title });
    return axon.deckCreatedForCard.createSignal({ deckId, title: payload.title, cardTitle: payload.cardTitle });
  },
});

// Card neuron: listens controller:card:create, upserts OIMDB
export const cardNeuron = neuron('card', {}).dendrite({
  collateral: controllerCreateCard,
  response: async (payload) => {
    cards.collection.upsertOne({ id: payload.cardId, deckId: payload.deckId, title: payload.title });
    return undefined;
  },
});

// Controller neuron: emits only its own collaterals (controller:*)
// Pass cardTitle through signal payloads, not context
export const controller = neuron('controller', { controllerCreateDeckForCard, controllerCreateCard })
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
      // cardTitle comes from payload, not context
      return axon.controllerCreateCard.createSignal({ deckId: payload.deckId, cardId: id(), title: payload.cardTitle });
    },
  });

// CNS
const cns = new CNS([controller, deckNeuron, cardNeuron]);

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

**SetBased Indexes** (`OIMReactiveIndexManualSetBased`):
- Returns `Set<TPk>` for efficient membership checks
- O(1) add/remove operations
- Best for frequent incremental updates

**ArrayBased Indexes** (`OIMReactiveIndexManualArrayBased`):
- Returns `TPk[]` for direct array access
- O(1) `setPks` operation (direct assignment, no diff computation)
- Best for full array replacements
- Note: `addPks`/`removePks` are O(n) - prefer `setPks` for better performance

## Integration with Other Libraries

### React (@oimdb/react)

The core library integrates seamlessly with React through dedicated hooks:

```typescript
import { useSelectEntitiesByPks, selectEntityByPk } from '@oimdb/react';

// React hooks automatically subscribe to reactive collections
const user = selectEntityByPk(users, 'user1');
const teamUsers = useSelectEntitiesByPks(users, userIds);
```

### Redux (@oimdb/redux-adapter)

> **⚠️ Experimental**: The Redux adapter is experimental. Functionality is not guaranteed and the API may change.

Migrate from Redux to OIMDB gradually or use both systems side-by-side with automatic two-way synchronization. See [Redux Migration Guide](/docs/frontend/redux-migration) for details.

## API Reference

### Core Classes

#### `OIMReactiveCollection<TEntity, TPk>`

Reactive collection with automatic change notifications and event coalescing.

**Constructor:**
```typescript
new OIMReactiveCollection(queue: OIMEventQueue, opts?: TOIMCollectionOptions<TEntity, TPk>)
```

**Key Methods:**
- `upsertOne(entity: TEntity): void` - Insert or update single entity
- `upsertMany(entities: TEntity[]): void` - Insert or update multiple entities
- `getOneByPk(pk: TPk): TEntity | undefined` - Get entity by primary key
- `getManyByPks(pks: readonly TPk[]): Map<TPk, TEntity | undefined>` - Get multiple entities

**Properties:**
- `updateEventEmitter: OIMUpdateEventEmitter<TPk>` - Key-specific subscriptions
- `coalescer: OIMUpdateEventCoalescerCollection<TPk>` - Event coalescing

#### `OIMRICollection<TEntity, TPk, ...>`

Reactive collection with integrated indexing capabilities.

**Constructor:**
```typescript
new OIMRICollection(queue: OIMEventQueue, opts: {
    collectionOpts?: TOIMCollectionOptions<TEntity, TPk>;
    indexes: TReactiveIndexMap;
})
```

**Properties:**
- `indexes: TReactiveIndexMap` - Named reactive indexes

#### `OIMReactiveIndexManualSetBased<TKey, TPk>`

Reactive Set-based index. Returns `Set<TPk>` for efficient membership checks.

**Methods:**
- `setPks(key: TKey, pks: readonly TPk[]): void` - Set primary keys (replaces entire Set)
- `addPks(key: TKey, pks: readonly TPk[]): void` - Add primary keys (O(1))
- `removePks(key: TKey, pks: readonly TPk[]): void` - Remove primary keys (O(1))
- `index.getPksByKey(key: TKey): Set<TPk>` - Query index

#### `OIMReactiveIndexManualArrayBased<TKey, TPk>`

Reactive Array-based index. Returns `TPk[]` for direct array access.

**Methods:**
- `setPks(key: TKey, pks: readonly TPk[]): void` - Set primary keys (O(1), recommended)
- `addPks(key: TKey, pks: readonly TPk[]): void` - Add primary keys (O(n))
- `removePks(key: TKey, pks: readonly TPk[]): void` - Remove primary keys (O(n))
- `index.getPksByKey(key: TKey): TPk[]` - Query index

#### `OIMEventQueue`

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
// Available types: 'immediate' | 'microtask' | 'timeout' | 'animationFrame'

OIMEventQueueSchedulerFactory.createMicrotask()
OIMEventQueueSchedulerFactory.createAnimationFrame()
OIMEventQueueSchedulerFactory.createTimeout(delay?: number)
OIMEventQueueSchedulerFactory.createImmediate()
```

## License

MIT License
