---
id: oimdb
title: React State Management with CNStra & OIMDB - Redux Alternative
sidebar_label: CNStra & OIMDB
slug: /frontend/oimdb
description: Learn how CNStra + OIMDB provides deterministic React state management. A performant alternative to Redux, MobX, Zustand. Type-safe, derived state, reactive updates, SOLID/SRP by design. Perfect for complex React applications.
keywords: [React state management, Redux alternative, MobX alternative, Zustand alternative, Recoil alternative, Jotai alternative, React hooks, derived state, reactive state, OIMDB, in-memory database, frontend orchestration, React best practices, type-safe React state, deterministic React, performance optimization, state synchronization, React state machine]
---

CNStra is an orchestration layer for state, replacing reducers, slices, thunks, and sagas with a typed neuron graph. OIMDB is a reactive in‑memory DB with indexed queries that is orders of magnitude faster than copying whole state trees on each change — but it requires a proper orchestrator. CNStra provides that orchestration.

Why not Flux?
- Flux-style reducers have unclear inter-reducer communication; coordinating dependent updates is awkward or expensive.
- Many state managers copy large trees to preserve immutability, which is slow and GC-heavy.
- There’s no built-in, efficient “after everything settles, emit UI events” mechanism.

Our approach:
- A controlling neuron orchestrates the sequence of updates across models.
- OIMDB stores normalized data with reactive indexes (no tree copies).
- After all model updates in a run, we flush the OIMDB event queue once, so the UI updates efficiently in batches.

Minimal setup

```ts
import { CNS, neuron, collateral } from '@cnstra/core';
import { OIMEventQueue, OIMEventQueueSchedulerMicrotask, OIMRICollection, OIMReactiveIndexManual } from '@oimdb/core';

const dbEventQueue = new OIMEventQueue({ scheduler: new OIMEventQueueSchedulerMicrotask() });
export const users = new OIMRICollection(dbEventQueue, {
  indexes: { byId: new OIMReactiveIndexManual<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (u: { id: string }) => u.id }
});

// Define UI/update collateral
const userUpdated = collateral<{ id: string; name: string }>('user:updated');

// Controlling neuron updates models and returns nothing (end of branch)
export const usersNeuron = neuron('users', {}).dendrite({
  collateral: userUpdated,
  response: (payload) => {
    users.collection.upsertOne({ id: payload.id, name: payload.name });
    // more model updates...
    // OIMDB event queue will flush after the run completes
    return undefined;
  },
});

const cns = new CNS([usersNeuron]);
```

React usage

```tsx
import { useSelectEntityByPk } from '@oimdb/react';

const EMPTY: any[] = [];

function UserName({ id }: { id: string }) {
  const user = useSelectEntityByPk(users, id) || null;
  return <span>{user?.name ?? ''}</span>;
}
```

Key points
- CNStra: deterministic orchestration, explicit branching, cancellation.
- OIMDB: normalized, indexed, reactive store; no full-tree copies.
- Together: predictable flows and high performance UI updates with a single flush after model updates.

## Updating multiple collections in one run

Best practice: each model is updated by its own domain neuron. The controller emits one controller‑owned signal with both payloads; each domain neuron listens and updates its model.

```ts
import { collateral, neuron } from '@cnstra/core';
import { OIMEventQueue, OIMEventQueueSchedulerMicrotask, OIMRICollection, OIMReactiveIndexManual } from '@oimdb/core';

// Event queue + collections
const dbEventQueue = new OIMEventQueue({ scheduler: new OIMEventQueueSchedulerMicrotask() });
export const users = new OIMRICollection(dbEventQueue, {
  indexes: { byId: new OIMReactiveIndexManual<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (u: { id: string }) => u.id },
});
export const posts = new OIMRICollection(dbEventQueue, {
  indexes: { byAuthor: new OIMReactiveIndexManual<string, string>(dbEventQueue) },
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

const EMPTY: any[] = [];

function AuthorWithPosts({ authorId }: { authorId: string }) {
  const user = useSelectEntityByPk(users, authorId) || null;
  const postsByAuthor = useSelectEntitiesByIndexKey(posts, 'byAuthor', authorId) || EMPTY;
  return (
    <section>
      <h4>{user?.name}</h4>
      <ul>{postsByAuthor.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </section>
  );
}
```

## Flux comparison (why this is better)

- Multiple reducers/slices need to coordinate ordering and cross-updates; you either duplicate logic or invent ad‑hoc messaging between slices.
- Immutable tree copies cause extra allocations and GC pressure; updating two parts often triggers two renders.
- There’s no first‑class “after everything settles” phase; batching is fragile and framework‑specific.
- With CNStra + OIMDB: a controlling neuron dictates order deterministically; OIMDB writes are O(1) upserts into normalized tables; the event queue flushes once after the run, so the UI updates predictably and fast.

## Example: Create Deck then Card (shared data)

Goal: on UI click, create a deck first (to obtain `deckId`), then create a card that needs that `deckId`. We orchestrate this with a controlling neuron; OIMDB persists models; the event queue flushes once after the run.

```ts
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import {
  OIMEventQueue,
  OIMEventQueueSchedulerMicrotask,
  OIMRICollection,
  OIMReactiveIndexManual,
} from '@oimdb/core';

// OIMDB setup
const dbEventQueue = new OIMEventQueue({ scheduler: new OIMEventQueueSchedulerMicrotask() });
export const decks = new OIMRICollection(dbEventQueue, {
  indexes: { byId: new OIMReactiveIndexManual<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (d: { id: string }) => d.id },
});
export const cards = new OIMRICollection(dbEventQueue, {
  indexes: { byDeck: new OIMReactiveIndexManual<string, string>(dbEventQueue) },
  collectionOpts: { selectPk: (c: { id: string }) => c.id },
});

// Collaterals
const uiCreateCardClick = collateral<{ deckTitle: string; cardTitle: string }>('ui:createCardClick');

// Controller owns these request collaterals (only controller emits them)
const controllerCreateDeck = collateral<{ title: string }>('controller:deck:create');
const controllerCreateCard = collateral<{ deckId: string; cardId: string; title: string }>('controller:card:create');

// Deck owns its response collateral (only deck emits it)
const deckCreated = collateral<{ deckId: string; title: string }>('deck:created');

// Services (mocked)
const deckService = { create: async (title: string) => 'deck-' + Math.random().toString(36).slice(2) };
const id = () => 'card-' + Math.random().toString(36).slice(2);

// Deck neuron: listens controller:deck:create, emits deck:created, upserts OIMDB
export const deckNeuron = neuron('deck', { deckCreated }).dendrite({
  collateral: controllerCreateDeck,
  response: async (payload, axon) => {
    const deckId = await deckService.create(payload.title);
    decks.collection.upsertOne({ id: deckId, title: payload.title });
    return axon.deckCreated.createSignal({ deckId, title: payload.title });
  },
});

// Card neuron: listens controller:card:create, upserts OIMDB
export const cardNeuron = neuron('card', {}).dendrite({
  collateral: controllerCreateCard,
  response: async (payload) => {
    cards.collection.upsertOne({ id: payload.cardId, deckId: payload.deckId, title: payload.title });
    return undefined; // end
  },
});

// Controller neuron: emits only its own collaterals (controller:*)
export const controller = withCtx<{ cardTitle?: string }>()
  .neuron('controller', { controllerCreateDeck, controllerCreateCard })
  .dendrite({
    collateral: uiCreateCardClick,
    response: (payload, axon, ctx) => {
      ctx.set({ cardTitle: payload.cardTitle });
      return axon.controllerCreateDeck.createSignal({ title: payload.deckTitle });
    },
  })
  .dendrite({
    collateral: deckCreated,
    response: (payload, axon, ctx) => {
      const title = ctx.get()?.cardTitle ?? 'New Card';
      return axon.controllerCreateCard.createSignal({ deckId: payload.deckId, cardId: id(), title });
    },
  });

// CNS
const cns = new CNS([controller, deckNeuron, cardNeuron]);

// UI click starts the run; OIMDB event queue flushes once after both upserts
await cns.stimulate(uiCreateCardClick.createSignal({ deckTitle: 'Inbox', cardTitle: 'First task' }));
```

Rule of ownership
- A neuron emits only collaterals from its own axon.
- Other neurons subscribe to those collaterals via dendrites.
- In this example, controller emits `controller:*` requests; deck emits `deck:created`; card writes data on `controller:card:create`.
