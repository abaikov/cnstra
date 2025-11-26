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

Modern apps are no longer CRUD.

They are **workflows**: multi‑step sequences that must remain consistent across UI, onboarding, background sync, imports, batch jobs, and automation.

But classic patterns treat flows as second‑class citizens. 

For example, on paper, MVC looks clean:

* Controllers call model methods,
* Models update data,
* Views rerender.

But the moment you create your first multi-step operation, the problems jump out at you.

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

* "We need the same operation during onboarding"
* "And during import"

—you now have **multiple scattered controller copies** of the same flow. Nothing ensures they stay consistent.

**MVC collapses the moment flows stop being trivial.**

---

## 2. REDUX — MVC Problem Solved... Or Is It?

Anyone who has dealt with a similar task of creating a deck with a card has probably come to roughly the following solution:

### Redux Toolkit reducers

```js
import { createSlice, createEntityAdapter } from '@reduxjs/toolkit';

const deckAdapter = createEntityAdapter();
const cardAdapter = createEntityAdapter();

const deckSlice = createSlice({
  name: 'deck',
  initialState: deckAdapter.getInitialState(),
  reducers: {
    cardWithDeckCreated: (state, action) => {
      deckAdapter.addOne(state, action.payload.deck);
    },
  },
});

const cardSlice = createSlice({
  name: 'card',
  initialState: cardAdapter.getInitialState(),
  reducers: {
    cardWithDeckCreated: (state, action) => {
      cardAdapter.addOne(state, action.payload.card);
    },
  },
});
```

### Flow thunk

```js
export const createCardWithDeck =
  (deckTitle, cardTitle) => (dispatch) => {
    const deck = { id: nanoid(), title: deckTitle };
    const card = { id: nanoid(), deckId: deck.id, title: cardTitle };

    dispatch({
      type: 'cardWithDeckCreated',
      payload: { deck, card },
    });
  };
```

In essence, you've recreated MVC: models (reducers) have no idea about the flow context, and the controller (thunk) just calls them sequentially.

Redux solves the problem of independent model updates well (not like in our example, of course, but when you don't need a flow).

But flows? Still invisible.

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

Let's revisit Deck + Card and see how the same flow can be triggered:

* from a **UI button** (createCardWithDeckButtonClicked), and
* from an **onboarding flow** (userEntersApp),

while keeping everything explicit.

```ts
import { CNS, collateral, neuron, withCtx, TCNSSignal } from '../src/index';

const uiAxon = {
    userEntersApp: collateral<{
        userId: string;
        deckTitle: string;
        cardTitle: string;
    }>('ui:user-enters-app'),
    createCardWithDeckButtonClicked: collateral<{
        deckTitle: string;
        cardTitle: string;
    }>('ui:create-card-with-deck-button-clicked'),
};

const deckAxon = {
    createdAtUserEntersApp: collateral<{
        deckId: string;
        cardTitle: string;
        userId: string;
    }>('ui:user-enters-app:deck:created'),
    createdAtCreateCardWithDeckButtonClicked: collateral<{
        deckId: string;
        cardTitle: string;
    }>('ui:create-card-with-deck-button-clicked:deck:created'),
};

const deck = neuron('deck', deckAxon)
    .dendrite({
        collateral: uiAxon.userEntersApp,
        response: (payload, axon) => {
            const deckId = 'deck-' + Math.random().toString(36).slice(2);
            return axon.createdAtUserEntersApp.createSignal({
                deckId,
                cardTitle: payload.cardTitle,
                userId: payload.userId,
            });
        },
    })
    .dendrite({
        collateral: uiAxon.createCardWithDeckButtonClicked,
        response: (payload, axon) => {
            const deckId = 'deck-' + Math.random().toString(36).slice(2);
            return axon.createdAtCreateCardWithDeckButtonClicked.createSignal({
                deckId,
                cardTitle: payload.cardTitle,
            });
        },
    });

const card = neuron('card', {})
    .dendrite({
        collateral: deckAxon.createdAtCreateCardWithDeckButtonClicked,
        response: payload => {
            console.log('card title', payload.cardTitle);
            // create a card
        },
    })
    .dendrite({
        collateral: deckAxon.createdAtUserEntersApp,
        response: payload => {
            console.log('card title', payload.cardTitle);
            // create a card
        },
    });

const cns = new CNS([deck, card]);

cns.stimulate(
    uiAxon.userEntersApp.createSignal({
        userId: 'user-123',
        deckTitle: 'Deck 1',
        cardTitle: 'Card 1',
    })
);

cns.stimulate(
    uiAxon.createCardWithDeckButtonClicked.createSignal({
        deckTitle: 'Deck 1',
        cardTitle: 'Card 1',
    })
);
```

- Each collateral has a **named, typed identity**.
- A neuron can only emit signals declared on **its own axon**.
- This prevents accidental emissions and guarantees explicit wiring.
- Even if two flows share logic, they stay **structurally distinct**.
- Both flows produce the **same deterministic orchestration**, but each carries its **own flow identity**.

This is impossible to achieve in MVC/Redux/Signals with the same compile-time guarantees without building your own CNStra on top.

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

* [Introduction](/docs/concepts/intro)
* [Quick Start](/docs/core/quick-start)
* [Basics](/docs/concepts/basics)
* [Best Practices](/docs/advanced/best-practices)

