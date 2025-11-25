---
id: cnstra
title: "CNStra: A New Generation of Application Orchestration"
sidebar_label: CNStra
slug: /concepts/cnstra
description: Discover CNStra, a new generation of application orchestration that makes flows explicit, traceable, and safe.
keywords: [CNStra, orchestration, flows, MVC, Redux, state management, explicit flows, traceability, workflows]
---

# CNStra: A New Generation of Application Orchestration

![Brain in Grass](/img/brain_in_grass.png)

## 1. MVC — Clean on Paper, Chaotic in Reality

Modern apps are no longer CRUD. They are **workflows**: multi‑step sequences that must remain consistent across UI, onboarding, background sync, imports, batch jobs, and automation.

But classic patterns treat flows as second‑class citizens.

Let's start with a simple example: **Deck + Card**.

On paper, MVC looks clean:

* Controllers call model methods,

* Models update data,

* Views rerender.

But the moment you introduce even a tiny multi-step operation, the cracks show immediately.

Flow: **"Create a deck, then create a card inside it."**

### Controller

```js

function onCreateCardClick(req) {

  const deck = Deck.create({ title: req.deckTitle });

  const card = Card.create({ deckId: deck.id, title: req.cardTitle });

}

```

### Models

```js

class Deck {

  static create(data) {

    return db.insert("decks", data);

  }

}

class Card {

  static create(data) {

    return db.insert("cards", data);

  }

}

```

That's it. Neither model has any idea:

* **why** it was created,

* **who** initiated the sequence,

* **what other operations** the flow includes,

* **which parent flow** it belongs to.

There is **no flow identity**, no **graph**, no **traceability**.

And when business later says:

* "We need the same operation during onboarding,"

* "And during import,"

—you now have **multiple scattered controller copies** of the same flow. Nothing ensures they stay consistent.

**MVC collapses the moment flows stop being trivial.**

---

## 2. REDUX — Events Become Explicit, but Flows Remain Invisible

Redux fixes one thing: **state transitions become explicit events**.

But the flow itself? Still invisible.

To express the Deck + Card flow, developers eventually invent a familiar workaround: flow‑scoped actions.

### Flow-scoped Redux actions

```js

const onboardingDeckCreated = (deckId, title) => ({

  type: "onboarding/deckCreated",

  payload: { deckId, title },

});

const onboardingCardCreated = (cardId, deckId, title) => ({

  type: "onboarding/cardCreated",

  payload: { cardId, deckId, title },

});

```

### Flow thunk

```js

export const createCardWithDeckForOnboarding =

  (deckTitle, cardTitle) => (dispatch) => {

    const deckId = nanoid();

    const cardId = nanoid();

    batch(() => {

      dispatch(onboardingDeckCreated(deckId, deckTitle));

      dispatch(onboardingCardCreated(cardId, deckId, cardTitle));

    });

  };

```

A quick `grep("onboarding/")` shows where the flow originates.

But here comes the real problem.

### The Forgotten Subflow Problem

Business says:

* "Reuse the same logic during import."

Your options both suck:

**Option 1 — Copy-paste with new prefixes** → Guaranteed drift.

**Option 2 — Generic events** → You lose flow identity entirely.

In both cases:

* no graph,

* no parent/child structure,

* no traceability,

* multiple dispatches per conceptual step.

Redux models **state**, not **orchestration**.

Flow correctness is still your problem.

---

## 3. MODERN STATE MANAGERS — Amazing Reactivity, Zero Orchestration

Zustand, Jotai, Recoil, MobX, Signals, Effector, Valtio…

All fantastic tools — but they solve **reactivity**, not **flows**.

Architecturally, they are **Reactive MVC**:

* atoms/stores/signals = **Model**,

* components = **View**,

* async helpers = **ad-hoc controllers**.

And exactly like MVC:

* state units have no idea what flows they participate in,

* controllers become an unstructured soup of async logic,

* multi-step operations are just naked functions.

```ts

createDeckAndCard();

```

Then onboarding calls it, import calls it, test suite calls it, background sync calls it.

Nothing describes a flow.

Nothing guarantees consistency.

Nothing warns you that you forgot to wire a subflow to a new parent.

**Reactive state ≠ orchestration.**

---

## 4. CNSTRA — Flows Become Explicit, Traceable, and Safe

![CNStra Art](/img/cnstra_art.png)

CNStra introduces something missing everywhere else:

### **Flows become real, typed orchestration nodes — not just functions.**

A flow in CNStra is a first-class entity with:

* explicit identity,

* explicit parent/child chains,

* deterministic run context,

* compiler-verified wiring,

* fully visible runtime traces.

Let's revisit Deck + Card and see how the same flow can be triggered:

* from a **UI button**, and

* from an **onboarding flow**,

while keeping everything explicit.

---

### Step 1 — Collaterals: UI, onboarding, and domain events

```ts

import { CNS, collateral, neuron } from '@cnstra/core';

import {

  OIMEventQueue,

  OIMEventQueueSchedulerFactory,

  OIMRICollection,

  OIMReactiveIndexManualSetBased,

} from '@oimdb/core';

// OIMDB SETUP (simplified)

const dbEventQueue = new OIMEventQueue({

  scheduler: OIMEventQueueSchedulerFactory.createMicrotask(),

});

export const decks = new OIMRICollection(dbEventQueue, {

  indexes: {

    byId: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue),

  },

  collectionOpts: { selectPk: (d: { id: string }) => d.id },

});

export const cards = new OIMRICollection(dbEventQueue, {

  indexes: {

    byDeck: new OIMReactiveIndexManualSetBased<string, string>(dbEventQueue),

  },

  collectionOpts: { selectPk: (c: { id: string }) => c.id },

});

// UI collaterals

const ui = {

  createCardClicked: collateral<{

    deckTitle: string;

    cardTitle: string;

  }>('ui:create-card-clicked'),

};

// Onboarding collaterals

const onboarding = {

  userEntersApp: collateral<{ userId: string }>(

    'onboarding:user-enters-app'

  ),

  createCardWithDeck: collateral<{

    deckTitle: string;

    cardTitle: string;

  }>('onboarding:create-card-with-deck'),

};

// Domain events

const deckEvents = {

  created: collateral<{

    deckId: string;

    deckTitle: string;

    cardTitle: string;

  }>('deck:created'),

};

```

Each collateral has a **named, typed identity**.

Jump to any collateral in your IDE — you see **all usage sites**.

Your editor becomes an orchestration graph browser.

---

### Step 2 — Onboarding neuron forwards into its own subflow

```ts

export const onboardingNeuron = neuron('onboarding', {

  createCardWithDeck: onboarding.createCardWithDeck,

}).dendrite({

  collateral: onboarding.userEntersApp,

  response: (payload, axon) => {

    const deckTitle = 'Welcome';

    const cardTitle = 'Start here';

    return axon.createCardWithDeck.createSignal({

      deckTitle,

      cardTitle,

    });

  },

});

```

A neuron can only emit signals declared on **its own axon**.

This prevents accidental emissions and guarantees explicit wiring.

---

### Step 3 — Deck neuron listens to BOTH UI and onboarding

Even if two flows share logic, they stay **structurally distinct**.

This is something MVC/Redux/Signals simply cannot offer.

```ts

const deckFlow = {

  fromUi: ui.createCardClicked,

  fromOnboarding: onboarding.createCardWithDeck,

};

```

Shared logic:

```ts

function handleCreateDeckAndEmitEvent(payload, axon) {

  const deckId = 'deck-' + Math.random().toString(36).slice(2);

  decks.collection.upsertOne({ id: deckId, title: payload.deckTitle });

  return axon.created.createSignal({

    deckId,

    deckTitle: payload.deckTitle,

    cardTitle: payload.cardTitle,

  });

}

```

Deck neuron:

```ts

export const deckNeuron = neuron('deck', {

  created: deckEvents.created,

}).bind(deckFlow, {

  fromUi: (payload, axon) => handleCreateDeckAndEmitEvent(payload, axon),

  fromOnboarding: (payload, axon) => handleCreateDeckAndEmitEvent(payload, axon),

});

```

Your IDE instantly exposes:

* UI → deck creation

* onboarding → deck creation

* any future flows → also explicit

---

### Step 4 — Card neuron reacts to deck domain event

```ts

export const cardNeuron = neuron('card', {}).dendrite({

  collateral: deckEvents.created,

  response: (payload) => {

    const cardId = 'card-' + Math.random().toString(36).slice(2);

    cards.collection.upsertOne({

      id: cardId,

      deckId: payload.deckId,

      title: payload.cardTitle,

    });

  },

});

```

---

### Step 5 — Wire CNS and trigger both flows

```ts

const cns = new CNS([

  deckNeuron,

  cardNeuron,

  onboardingNeuron,

]);

// UI button flow

await cns.stimulate(

  ui.createCardClicked.createSignal({

    deckTitle: 'Inbox',

    cardTitle: 'First task',

  })

);

// Onboarding flow

await cns.stimulate(

  onboarding.userEntersApp.createSignal({ userId: 'user-123' })

);

```

Both flows produce the **same deterministic orchestration**, but each carries its **own flow identity**.

This is impossible to achieve in MVC/Redux/Signals.

---

## 4.1 The Orchestration Graph (Conceptual View)

```
UI "Create card" button

  └─ ui:create-card-clicked

       └─ deckNeuron

            └─ deck:created

                 └─ cardNeuron

onboarding:user-enters-app

  └─ onboardingNeuron

        └─ onboarding:create-card-with-deck

              └─ deckNeuron

                   └─ deck:created

                        └─ cardNeuron

```

CNStra turns your IDE into a **flow explorer**:

* Jump to `ui.createCardClicked` → see all listeners.

* Jump to `onboarding.createCardWithDeck` → see emitters & subscribers.

* Jump to `deckEvents.created` → see every downstream consumer.

This is what orchestration visibility looks like.

---

## 5. Exhaustive Binding — The Guarantee Everyone Else Lacks

Every other architecture suffers from the same silent failure mode:

> **Flows evolve. Subscribers don't. No one warns you.**

CNStra eliminates this entire class of bugs.

### `neuron.bind(axon, handlers)` enforces EXHAUSTIVENESS

```ts

const order = {

  created:   collateral<...>('order:created'),

  updated:   collateral<...>('order:updated'),

  cancelled: collateral<...>('order:cancelled'),

};

const orderMailer = neuron('order-mailer', {})

  .bind(order, {

    created:   (p) => sendCreated(p),

    updated:   (p) => sendUpdated(p),

    cancelled: (p) => sendCancelled(p),

  });

```

Then the domain evolves:

```ts

order.refunded = collateral<...>('order:refunded');

```

### What happens?

* MVC / Redux / Zustand / Jotai / MobX / Signals → **no warnings, silent bug**.

* CNStra → **TypeScript error: missing handler for `refunded`**.

You literally **cannot ship** an incomplete flow.

---

## 6. Benchmarks

**📊 [View Full Benchmark Report](/docs/frontend/benchmark)** | **🔗 [Interactive Results](https://abaikov.github.io/cnstra-oimdb-bench/)** | **📦 [Source Code](https://github.com/abaikov/cnstra-oimdb-bench)**

### Execution Time

CNStra + OIMDB leads in all categories:

| Scenario | CNStra + OIMDB | Zustand | Redux Toolkit | Effector |
|----------|----------------|---------|---------------|----------|
| Background Churn | **69.4ms** | 83.0ms | 100.6ms | 127.3ms |
| Inline Editing | **70.8ms** | 152.9ms | 250.5ms | 400.4ms |
| Bulk Update | **50.7ms** | 81.2ms | 156.8ms | 103.7ms |

### Memory Usage

Top results in two categories, competitive in the third:

| Scenario | CNStra + OIMDB | Zustand | Redux Toolkit | Effector |
|----------|----------------|---------|---------------|----------|
| Background Churn | **5.5 MB** | 5.8 MB | 6.0 MB | 3.4 MB |
| Inline Editing | **1.1 MB** | 3.5 MB | 3.1 MB | 6.5 MB |
| Bulk Update | **1.7 MB** | 3.6 MB | 5.1 MB | 4.4 MB |

### Code Complexity

Second simplest codebase (394 LOC) while being the fastest — no trade-offs between performance and structure.

---

## Final Summary

Most architectures:

* expose state updates,

* but keep flows **implicit**.

That's why orchestration rots.

CNStra flips the model:

* state becomes explicit (via OIMDB),

* flows become explicit (via collaterals),

* parent/child chains are tracked automatically,

* compile-time safety eliminates missing handlers,

* performance rivals handcrafted atomic stores.

This is not Flux 3.0 or "better Redux".

### This is the first explicit orchestration layer designed specifically for the realities of the modern web.

![Eye](/img/eye.png)

Frontend or backend — same primitives, same guarantees:

* workflows,

* pipelines,

* background jobs,

* domain events,

* distributed flows.

If you want a deep-dive into:

* multi-neuron workflows,

* concurrency gates & backpressure,

* distributed orchestration,

* real production pipelines,

