---
id: best-practices
title: Best Practices
sidebar_label: Best Practices
slug: /advanced/best-practices
description: Best practices for building robust CNStra applications. Learn about context store usage, collateral design, idempotency, and handling non-serializable data.
keywords: [best practices, context store, idempotency, collaterals, non-serializable data, message brokers, retries, design patterns]
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
  .neuron('processor', { output })
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
  .neuron('processor', { output })
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
const userCreated = collateral<{ userId: string }>('user:created');
const userUpdated = collateral<{ userId: string; changes: Record<string, unknown> }>('user:updated');
const userDeleted = collateral<{ userId: string }>('user:deleted');
const userError = collateral<{ userId: string; error: string }>('user:error');

const userHandler = neuron('userHandler', { userCreated, userUpdated, userDeleted, userError })
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
const userEvent = collateral<{ type: 'created' | 'updated' | 'deleted'; userId: string }>('user:event');

const userHandler = neuron('userHandler', { userEvent })
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
const processPayment = neuron('processPayment', { paymentProcessed })
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
const processPayment = neuron('processPayment', { paymentProcessed })
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
const processRequest = collateral<{ userId: string; blobId: string }>('processRequest');
const processResult = collateral<{ userId: string; success: boolean }>('processResult');

// Non-serializable data (only within the process)
const blobData = collateral<{ userId: string; blob: Blob }>('blobData');
const blobProcessed = collateral<{ userId: string; success: boolean }>('blobProcessed');

// Transaction neuron: creates inner stimulation with blob
const ctxBuilder = withCtx<{ innerStimulation?: Promise<void> }>();

const transactionNeuron = ctxBuilder.neuron('transaction', { processResult }).dendrite({
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
const blobProcessor = neuron('blobProcessor', { blobProcessed }).dendrite({
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
- **Pass entire context store**: Use `ctx: ctx` (the store instance), not `contextValues: ctx.get()` (just values)
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
const createDeckWithCardButtonClick = collateral<{ userId: string; deckName: string }>(
  'create-deck-with-card-button-click'
);

// Deck neuron response
const createDeckWithCardButtonClickDeckCreated = collateral<{ deckId: string; userId: string }>(
  'create-deck-with-card-button-click:deck:deck-created'
);

// Card neuron response
const createDeckWithCardButtonClickCardCreated = collateral<{ cardId: string; deckId: string }>(
  'create-deck-with-card-button-click:deck:card-created'
);

const deckNeuron = neuron('deckNeuron', { createDeckWithCardButtonClickDeckCreated })
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

const cardNeuron = neuron('cardNeuron', { createDeckWithCardButtonClickCardCreated })
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
const buttonClick = collateral<{ action: string; userId: string }>('button-click');
const entityCreated = collateral<{ type: string; id: string }>('entity-created');

// Hard to trace which button click caused which creation
const handler = neuron('handler', { entityCreated })
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

## Summary

1. **Context store**: Store only per-neuron per-stimulation metadata, not business data
2. **Collaterals**: Create separate collaterals for each response type
3. **Idempotency**: Ensure neurons are idempotent when using retries
4. **Non-serializable data**: Use separate stimulations with shared context store for non-serializable payloads
5. **User interactions**: Each user interaction should be a unique signal with unique responses for better traceability and system visibility

Following these practices will help you build robust, maintainable CNStra applications that handle edge cases gracefully.

