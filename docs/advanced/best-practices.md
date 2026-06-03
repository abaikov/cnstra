---
id: best-practices
title: Best Practices
sidebar_label: Best Practices
slug: /advanced/best-practices
description: Best practices for building robust CNStra applications. Domain neuron ownership, collateral naming, intent collaterals, neuron focus, context store, idempotency.
keywords: [best practices, context store, idempotency, collaterals, non-serializable data, domain neuron, neuron ownership, event naming, intent collateral, afferent path, mapper layer, auxiliary neuron, design patterns]
---

This guide covers best practices for building robust, maintainable CNStra applications.

## Context Store Usage

### Store Only Per-Neuron Per-Stimulation Metadata

**Don't store business data in context store.** Context is designed for per-neuron per-stimulation metadata (retry attempts, debounce state, processing stats), not for passing business data between neurons.

**Why?** Signals can arrive unexpectedly and out of order. If you store business data in context, you risk:
- Data inconsistency when signals arrive in unexpected order
- Race conditions when multiple signals process the same context
- Memory leaks if context grows large with business data
- Difficult debugging when context contains mixed metadata and business data

**✅ Good**: Store only metadata in context

```ts
const processor = withCtx<{ attempt: number; startTime: number }>()
  .neuron({ output })
  .dendrite({
    collateral: input,
    response: async (payload, axon, ctx) => {
      // Context stores per-neuron per-stimulation metadata
      const attempt = (ctx.get()?.attempt || 0) + 1;
      ctx.set({ attempt, startTime: ctx.get()?.startTime || Date.now() });
      
      // Business data flows through payloads
      return axon.output.createSignal({ 
        userId: payload.userId,
        result: `Processed (attempt ${attempt})` 
      });
    }
  });
```

**❌ Bad**: Storing business data in context

```ts
const processor = withCtx<{ users: User[]; orders: Order[] }>()
  .neuron({ output })
  .dendrite({
    collateral: input,
    response: async (payload, axon, ctx) => {
      // ❌ Don't store business data in context
      const users = ctx.get()?.users || [];
      users.push(payload.user);
      ctx.set({ users, orders: ctx.get()?.orders || [] });
      
      return axon.output.createSignal({ done: true });
    }
  });
```

**Use context for:**
- Retry attempt counters
- Debounce timers and state
- Processing statistics (counters, timestamps)
- Temporary flags and state

**Pass business data through:**
- Signal payloads (recommended)
- External storage (database, cache) if persistence is needed

## One Collateral Per Response Type

**Create separate collaterals for each distinct response type.** This improves type safety, makes the graph more readable, and prevents confusion about what each signal represents.

**✅ Good**: Separate collaterals for different outcomes

```ts
const userCreated = collateral<{ userId: string }>();
const userUpdated = collateral<{ userId: string; changes: Record<string, unknown> }>('user:updated');
const userDeleted = collateral<{ userId: string }>();
const userError = collateral<{ userId: string; error: string }>();

const userHandler = neuron({ userCreated, userUpdated, userDeleted, userError })
  .dendrite({
    collateral: createUser,
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
    collateral: createUser,
    response: async (payload, axon) => {
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

**Ensure neurons are idempotent when using retries.** Idempotency means that calling the same operation multiple times produces the same result as calling it once.

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
      return axon.paymentProcessed.createSignal({ paymentId: payment.id });
    },
  });
```

**Idempotency strategies:**
- **Idempotency keys**: Include unique keys in payloads, check before processing
- **Database constraints**: Use unique constraints to prevent duplicates
- **Status checks**: Check current state before modifying
- **Compare-and-swap**: Use atomic operations when updating state

## Non-Serializable Payloads in Separate Stimulations

**When working with message brokers (BullMQ, SQS, etc.), signals must be serializable (JSON).** For non-serializable data (blobs, file handles, database connections), use separate stimulations with shared context store.

**Key insight**: You can pass the entire context store (not just values) to a new stimulation. The new stimulation will update the same context store, making it behave as if it's part of the original stimulation. This is especially useful for retries with persistence.

**✅ Good**: Separate stimulation with shared context store

```ts
import { Queue, Worker, Job } from 'bullmq';
import { CNS, neuron, withCtx, collateral } from '@cnstra/core';

// Serializable data for the queue
const processRequest = collateral<{ userId: string; blobId: string }>();
const processResult = collateral<{ userId: string; success: boolean }>();

// Non-serializable data (only within the process)
const blobData = collateral<{ userId: string; blob: Blob }>();
const blobProcessed = collateral<{ userId: string; success: boolean }>();

// Transaction neuron: creates inner stimulation with blob
const ctxBuilder = withCtx<{ innerStimulation?: Promise<void> }>();

const transactionNeuron = ctxBuilder.neuron({ processResult }).dendrite({
  collateral: processRequest,
  response: async (payload, axon, ctx) => {
    // Get blob from storage (non-serializable)
    const blob = await blobStorage.get(payload.blobId);
    
    // Create inner stimulation with blob
    // Pass the entire context store (not just values)
    // This allows the inner stimulation to update the same context store
    const innerStimulation = ctx.cns.stimulate(
      blobData.createSignal({ userId: payload.userId, blob }),
      {
        // Pass the entire context store - inner stimulation updates the same store
        ctx: ctx, // This is the context store instance, not ctx.get()
      }
    );
    
    // Store stimulation promise in context
    ctx.set({ innerStimulation: innerStimulation.waitUntilComplete() });
    
    // Wait for inner stimulation to complete
    await innerStimulation.waitUntilComplete();
    
    // Return serializable result
    return axon.processResult.createSignal({ 
      userId: payload.userId, 
      success: true 
    });
  },
});

// Neuron for processing blob (runs only within the process)
const blobProcessor = neuron({ blobProcessed }).dendrite({
  collateral: blobData,
  response: async (payload, axon, ctx) => {
    // Process blob (non-serializable object)
    await processBlob(payload.blob);
    
    // Update shared context store (same instance as parent stimulation)
    const metadata = ctx.get() || { processedCount: 0 };
    ctx.set({ processedCount: metadata.processedCount + 1 });
    
    return axon.blobProcessed.createSignal({ 
      userId: payload.userId, 
      success: true 
    });
  },
});

const cns = new CNS([transactionNeuron, blobProcessor]);

// BullMQ worker
const worker = new Worker('jobs', async (job: Job<{ signal: any }>) => {
  const { signal } = job.data;
  
  // Stimulation runs in this process
  // If an error occurs, blob won't be in results
  const stimulation = cns.stimulate(signal);
  await stimulation.waitUntilComplete();
  
  // Return only serializable results
  return { success: true };
});

// Enqueue job (only serializable data)
await queue.add('process', {
  signal: processRequest.createSignal({ 
    userId: '42', 
    blobId: 'blob-123' // only ID, not the blob itself
  })
});
```

**Key points:**
- **Pass entire context store**: Use `ctx: ctx` (the store instance)
- **Shared context**: Inner stimulation updates the same context store as parent
- **Behaves as one stimulation**: For retries with persistence, both stimulations share the same context
- **Non-serializable data stays in process**: Blobs and handles never leave the process memory
- **Only serializable data in queue**: Queue only contains IDs and metadata

**When to use:**
- Working with message brokers that require JSON serialization
- Processing large files or blobs
- Using database connections or other non-serializable resources
- Need to maintain context state across inner stimulations for retries

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
      const deck = await createDeck(payload);
      return axon.createDeckWithCardButtonClickDeckCreated.createSignal({
        deckId: deck.id,
        userId: payload.userId,
      });
    },
  });

const cardNeuron = neuron({ createDeckWithCardButtonClickCardCreated })
  .dendrite({
    collateral: createDeckWithCardButtonClickDeckCreated,
    response: async (payload, axon) => {
      const card = await createCard({ deckId: payload.deckId });
      return axon.createDeckWithCardButtonClickCardCreated.createSignal({
        cardId: card.id,
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
const onboardingNeuron = neuron({ userOnboarded }).dendrite({
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
import { toDeckEntity } from './deck.mapper';

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

1. **Context store**: Store only per-neuron per-stimulation metadata, not business data
2. **Collaterals**: Create separate collaterals for each response type
3. **Idempotency**: Ensure neurons are idempotent when using retries
4. **Non-serializable data**: Use separate stimulations with shared context store for non-serializable payloads
5. **User interactions**: Each user interaction should be a unique signal with unique responses for better traceability and system visibility
6. **Domain ownership**: Each domain model has one owning neuron — all mutations live there, nowhere else
7. **Event naming**: Collaterals describe past events, not commands; keep afferent paths separate instead of merging them into intent collaterals
8. **Neuron focus**: Keep dendrite responses focused on mutations; extract mappings to utility functions and I/O to auxiliary neurons

Following these practices will help you build robust, maintainable CNStra applications that handle edge cases gracefully.

