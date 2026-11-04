---
id: best-practices
title: Best Practices
sidebar_label: Best Practices
slug: /advanced/best-practices
description: Best practices for building robust CNStra applications. Domain neuron ownership, collateral naming, intent collaterals, neuron focus, idempotency.
keywords: [best practices, idempotency, collaterals, domain neuron, neuron ownership, event naming, intent collateral, afferent path, mapper layer, auxiliary neuron, design patterns]
---

This guide covers best practices for building robust, maintainable CNStra applications.

```ts setup
import { collateral, neuron } from '@cnstra/core';

type Plan = { id: string; name: string };

const userSignupSubmitted = collateral<{ id: string; email: string }>();
const userRegistered = collateral<{ userId: string }>();
const paymentRequest = collateral<{ idempotencyKey: string; amount: number }>();
const paymentProcessed = collateral<{ paymentId: string; status: string }>();
const uiAxon = { createDeckButtonClicked: collateral<{ userId: string; title: string }>() };
const onboardingAxon = { userOnboarded: collateral<{ userId: string }>() };
const importAxon = { deckRowParsed: collateral<{ title: string; importId: string }>() };

declare function createUser(input: { id: string; email: string }): Promise<{ id: string }>;
declare function chargeCard(request: { idempotencyKey: string; amount: number }): Promise<{ id: string; status: string }>;
declare function toDeckEntity(row: { title: string; importId: string }): { title: string };
declare const api: {
  getUser(userId: string): Promise<{ preferredDeckTitle?: string }>;
  getPlan(userId: string): Promise<Plan>;
};
declare const db: {
  payments: {
    findOne(query: { idempotencyKey: string }): Promise<{ id: string; status: string } | null>;
    create(row: { id: string; idempotencyKey: string; status: string }): Promise<void>;
  };
  decks: { create(row: { title: string; userId?: string; planId?: string }): Promise<string> };
  cards: { create(row: { deckId: string }): Promise<string> };
  users: { update(userId: string, changes: { onboarded: boolean }): Promise<void> };
};
```

## One Collateral Per Response Type

**Create separate collaterals for each distinct response type.** This improves type safety, makes the graph more readable, and prevents confusion about what each signal represents.

**✅ Good**: Separate collaterals for different outcomes

```ts
const userCreated = collateral<{ userId: string }>();
const userUpdated = collateral<{ userId: string; changes: Record<string, unknown> }>();
const userDeleted = collateral<{ userId: string }>();
const userError = collateral<{ userId: string; error: string }>();

const userHandler = neuron({ userCreated, userUpdated, userDeleted, userError })
  .dendrite({
    collateral: userSignupSubmitted,
    response: async (payload, axon) => {
      try {
        const user = await createUser(payload);
        return axon.userCreated.createSignal({ userId: user.id });
      } catch (error) {
        return axon.userError.createSignal({ userId: payload.id, error: String(error) });
      }
    },
  });
```

**❌ Bad**: Reusing collaterals for different purposes

```ts
const userEvent = collateral<{ type: 'created' | 'updated' | 'deleted'; userId: string }>();

const userHandler = neuron({ userEvent })
  .dendrite({
    collateral: userSignupSubmitted,
    response: async (payload, axon) => {
      const user = await createUser(payload);
      // ❌ Using same collateral for different event types
      return axon.userEvent.createSignal({ type: 'created', userId: user.id });
    },
  });
```

**Benefits of separate collaterals:**
- **Type safety**: Each collateral has a specific payload type
- **Graph clarity**: Easy to see what signals a neuron can emit
- **Subscriber clarity**: Subscribers know exactly what they're listening to
- **Better error handling**: Errors can have their own collateral type

## Idempotency for Retries

**Make neurons idempotent when using retries.** Idempotency means that calling the same operation multiple times produces the same result as calling it once.

**Why?** When retries occur (via BullMQ, SQS, or manual retries), the same signal may be processed multiple times. Without idempotency, you risk:
- Duplicate operations (e.g., charging a user twice)
- Inconsistent state (e.g., creating duplicate records)
- Data corruption

**✅ Good**: Idempotent operations

```ts
const processPayment = neuron({ paymentProcessed })
  .dendrite({
    collateral: paymentRequest,
    response: async (payload, axon) => {
      // Check if payment already processed (idempotency check)
      const existingPayment = await db.payments.findOne({ 
        idempotencyKey: payload.idempotencyKey 
      });
      
      if (existingPayment) {
        // Already processed - return existing result
        return axon.paymentProcessed.createSignal({ 
          paymentId: existingPayment.id,
          status: existingPayment.status 
        });
      }
      
      // Process payment
      const payment = await chargeCard(payload);
      await db.payments.create({ 
        id: payment.id,
        idempotencyKey: payload.idempotencyKey,
        status: payment.status 
      });
      
      return axon.paymentProcessed.createSignal({ 
        paymentId: payment.id,
        status: payment.status 
      });
    },
  });
```

**❌ Bad**: Non-idempotent operations

```ts
const processPayment = neuron({ paymentProcessed })
  .dendrite({
    collateral: paymentRequest,
    response: async (payload, axon) => {
      // ❌ No idempotency check - will charge multiple times on retry
      const payment = await chargeCard(payload);
      return axon.paymentProcessed.createSignal({ paymentId: payment.id, status: payment.status });
    },
  });
```

**Idempotency strategies:**
- **Idempotency keys**: Include unique keys in payloads, check before processing
- **Database constraints**: Use unique constraints to prevent duplicates
- **Status checks**: Check current state before modifying
- **Compare-and-swap**: Use atomic operations when updating state

## Unique Signals for User Interactions

**Each user interaction should be a unique signal with unique responses.** This makes the system more transparent - you can see exactly what the system is reacting to, which simplifies system design and debugging.

**Why?** When every user interaction has its own unique signal chain, you get:
- **Traceability**: Easy to trace which user action triggered which system responses
- **System visibility**: Clear understanding of what the system reacts to
- **Easier debugging**: When something goes wrong, you know exactly which interaction caused it
- **Better design**: Forces you to think about the flow explicitly

**Trade-off**: This approach increases boilerplate code, but the benefits in maintainability and clarity outweigh the cost.

**✅ Good**: Unique signals for user interactions with hierarchical naming

```ts
// User interaction signal
const createDeckWithCardButtonClick = collateral<{ userId: string; deckName: string }>();

// Deck neuron response
const createDeckWithCardButtonClickDeckCreated = collateral<{ deckId: string; userId: string }>();

// Card neuron response
const createDeckWithCardButtonClickCardCreated = collateral<{ cardId: string; deckId: string }>();

const deckNeuron = neuron({ createDeckWithCardButtonClickDeckCreated })
  .dendrite({
    collateral: createDeckWithCardButtonClick,
    response: async (payload, axon) => {
      const deckId = await db.decks.create({ title: payload.deckName, userId: payload.userId });
      return axon.createDeckWithCardButtonClickDeckCreated.createSignal({
        deckId,
        userId: payload.userId,
      });
    },
  });

const cardNeuron = neuron({ createDeckWithCardButtonClickCardCreated })
  .dendrite({
    collateral: createDeckWithCardButtonClickDeckCreated,
    response: async (payload, axon) => {
      const cardId = await db.cards.create({ deckId: payload.deckId });
      return axon.createDeckWithCardButtonClickCardCreated.createSignal({
        cardId,
        deckId: payload.deckId,
      });
    },
  });
```

**Naming convention**: Use hierarchical naming to show the flow
- Base signal: `create-deck-with-card-button-click` (user interaction)
- First response: `create-deck-with-card-button-click:deck:deck-created` (component:action)
- Second response: `create-deck-with-card-button-click:deck:card-created` (component:action)

**❌ Bad**: Reusing generic signals for different user interactions

```ts
// ❌ Generic signal reused for multiple interactions
const buttonClick = collateral<{ action: string; userId: string }>();
const entityCreated = collateral<{ type: string; id: string }>();

// Hard to trace which button click caused which creation
const handler = neuron({ entityCreated })
  .dendrite({
    collateral: buttonClick,
    response: async (payload, axon) => {
      // Which button? Which user interaction? Unclear!
      return axon.entityCreated.createSignal({ type: 'deck', id: '123' });
    },
  });
```

**Benefits:**
- **Clear traceability**: Every signal chain traces back to a specific user action
- **System transparency**: Easy to see what triggers what
- **Better debugging**: Know exactly which interaction caused an issue
- **Explicit design**: Forces explicit thinking about user interaction flows

## Domain Neuron Ownership

### One Model, One Neuron

**Each domain model should have exactly one neuron responsible for all its mutations.** Other neurons must not write to a model they don't own — they can read it, but mutations belong to the owning neuron.

**Why?** When mutations are scattered across multiple neurons, it becomes impossible to reason about what state a model can be in, and impossible to find all the places that change it. The owning neuron is the single source of truth for how that model evolves.

**✅ Good**: one `deckNeuron` owns all deck mutations

```ts
const deckAxon = {
  createdAtOnboarding: collateral<{ deckId: string; userId: string }>(),
  createdAtButtonClick: collateral<{ deckId: string }>(),
  renamed: collateral<{ deckId: string; title: string }>(),
  archived: collateral<{ deckId: string }>(),
};

const deckNeuron = neuron(deckAxon)
  .dendrite({
    collateral: uiAxon.createDeckButtonClicked,
    response: async (payload, axon) => {
      const deckId = await db.decks.create({ title: payload.title });
      return axon.createdAtButtonClick.createSignal({ deckId });
    },
  })
  .dendrite({
    collateral: onboardingAxon.userOnboarded,
    response: async (payload, axon) => {
      const deckId = await db.decks.create({ title: 'My first deck' });
      return axon.createdAtOnboarding.createSignal({ deckId, userId: payload.userId });
    },
  });
```

**❌ Bad**: deck mutations spread across neurons

```ts
// ❌ onboardingNeuron mutates decks — that's deckNeuron's responsibility
const onboardingNeuron = neuron(onboardingAxon).dendrite({
  collateral: userRegistered,
  response: async (payload, axon) => {
    await db.decks.create({ title: 'My first deck', userId: payload.userId }); // ❌
    await db.users.update(payload.userId, { onboarded: true });
    return axon.userOnboarded.createSignal({ userId: payload.userId });
  },
});
```

### Collaterals Represent Past Events, Not Commands

**Name collaterals in the past tense — they describe something that already happened**, not an instruction to do something. A collateral is an observable fact emitted by a neuron, not a request sent to one.

```ts
// ✅ Past events
const deckCreated = collateral<{ deckId: string }>();
const paymentFailed = collateral<{ orderId: string; reason: string }>();
const userOnboarded = collateral<{ userId: string }>();

// ❌ Commands / instructions
const createDeck = collateral<{ title: string }>();      // sounds like a request
const failPayment = collateral<{ orderId: string }>();   // sounds like an order
```

This matters for readability and for correctly understanding the graph: a subscriber reacts to what *happened*, not to what it's being asked to do.

### Intent Collaterals — Use with Caution

Sometimes the same logical operation is triggered from many places (button click, onboarding, import, API). It's tempting to create a single "command" collateral to avoid duplicating downstream wiring:

```ts
// Intent collateral — groups all "create deck" triggers into one
const createDeckIntentActivated = collateral<{ title: string; source: string }>();
```

This works, but comes with a significant trade-off: **you lose afferent path traceability**. When `createDeckIntentActivated` fires, there is no way to see in the graph *where* it came from and *why* — all sources collapse into one anonymous signal.

**Prefer keeping afferent paths separate:**

```ts
// ✅ Each source has its own collateral — origin is always visible
const deckAxon = {
  createdAtButtonClick: collateral<{ deckId: string }>(),
  createdAtOnboarding: collateral<{ deckId: string; userId: string }>(),
  createdAtImport: collateral<{ deckId: string; importId: string }>(),
};
```

If you do use intent collaterals, keep them at the boundary of your system (e.g., as a public API for external callers) and document the sources explicitly. Never use them as a shortcut to avoid thinking about the graph.

### Keep Neuron Code Focused on Mutations

**A domain neuron's dendrite responses should primarily contain mutations — creating, updating, or deleting the model it owns.** Everything else is noise that makes the neuron harder to read and reason about.

Move non-mutation logic out:

**Mappings and transformations → utility functions or a mapper layer**

```ts
// ✅ Mapping lives outside the neuron
const deckAxon = {
  createdAtImport: collateral<{ deckId: string; importId: string }>(),
};

const deckNeuron = neuron(deckAxon).dendrite({
  collateral: importAxon.deckRowParsed,
  response: async (payload, axon) => {
    const entity = toDeckEntity(payload); // mapping extracted
    const deckId = await db.decks.create(entity);
    return axon.createdAtImport.createSignal({ deckId, importId: payload.importId });
  },
});
```

**Concurrent I/O, retries, external requests → auxiliary neurons**

When a domain neuron needs to make multiple external calls (fetch user, fetch plan, call API), extract that work into a dedicated auxiliary neuron that runs the I/O and emits a ready signal. The domain neuron then receives clean data and only runs its mutation.

```ts
// Auxiliary neuron: fetches everything needed, emits one ready signal
const deckCreateDataFetched = collateral<{
  userId: string;
  plan: Plan;
  defaultTitle: string;
}>();

const deckCreateFetcherNeuron = neuron({ deckCreateDataFetched }).dendrite({
  collateral: uiAxon.createDeckButtonClicked,
  response: async (payload, axon) => {
    const [user, plan] = await Promise.all([
      api.getUser(payload.userId),
      api.getPlan(payload.userId),
    ]);
    return axon.deckCreateDataFetched.createSignal({
      userId: payload.userId,
      plan,
      defaultTitle: user.preferredDeckTitle ?? 'New Deck',
    });
  },
});

// Domain neuron: only mutates
const deckAxon = {
  createdAtButtonClick: collateral<{ deckId: string }>(),
};

const deckNeuron = neuron(deckAxon).dendrite({
  collateral: deckCreateDataFetched,
  response: async (payload, axon) => {
    const deckId = await db.decks.create({
      userId: payload.userId,
      title: payload.defaultTitle,
      planId: payload.plan.id,
    });
    return axon.createdAtButtonClick.createSignal({ deckId });
  },
});
```

This separation keeps domain neurons readable, testable, and focused — and makes auxiliary logic easy to reuse or replace independently.

## Summary

1. **Data flow**: All per-run data (including retry counters) flows through signal payloads; pass dependencies through a [factory function](../core/api.md#dependencies-a-store-a-database-a-clock)
2. **Collaterals**: Create separate collaterals for each response type
3. **Idempotency**: make neurons idempotent when using retries
4. **User interactions**: Each user interaction should be a unique signal with unique responses for better traceability and system visibility
5. **Domain ownership**: Each domain model has one owning neuron — all mutations live there, nowhere else
6. **Event naming**: Collaterals describe past events, not commands; keep afferent paths separate instead of merging them into intent collaterals
7. **Neuron focus**: Keep dendrite responses focused on mutations; extract mappings to utility functions and I/O to auxiliary neurons

Following these practices will help you build robust, maintainable CNStra applications that handle edge cases gracefully.

