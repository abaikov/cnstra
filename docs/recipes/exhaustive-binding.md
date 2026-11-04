---
id: exhaustive-binding
title: Exhaustive Binding - Compile-Time Safety for Neuron Subscriptions
sidebar_label: Exhaustive Binding
slug: /recipes/exhaustive-binding
description: Learn how to use neuron.bind() for exhaustive subscriptions with compile-time safety. Never miss handling new collaterals when a neuron's axon changes.
keywords: [exhaustive binding, compile-time safety, type safety, exhaustive subscriptions, neuron bind, exhaustive check, TypeScript safety, exhaustive pattern, exhaustive switch, exhaustive map, type checking, compile-time guarantees]
---

Use `neuron.bind(axon, map)` to subscribe to every collateral of another neuron's axon with compile-time exhaustiveness checking. So if a developer adds a new collateral to the axon you're binding to, TypeScript will immediately flag missing handlers, preventing you from forgetting to handle new cases.

## Why Exhaustive Binding?

When a neuron's axon evolves (new collaterals are added), any neurons that react to those collaterals must be updated. Without exhaustive binding, it's easy to miss new cases, leading to silent failures or incomplete behavior. With `bind()`, the compiler enforces completeness.

## Basic Example

```ts setup
import { collateral, neuron } from '@cnstra/core';

declare function sendEmail(message: string): void;
declare function notifyUser(id: string): Promise<void>;
declare function sendWelcomeEmail(email: string): Promise<void>;
declare function sendVerificationConfirmation(userId: string): Promise<void>;
declare function sendSuspensionNotice(userId: string, reason: string): Promise<void>;
declare function sendDeletionConfirmation(userId: string): Promise<void>;
declare function logAudit(event: string, payload: unknown): void;
declare const metrics: { increment(name: string, tags: Record<string, unknown>): void };

const notified = collateral<{ id: string }>();
```

```ts
// Order domain model (axon)
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
};

// Mailer neuron must react to ALL order events
const orderMailer = neuron({})
  .bind(order, {
    created: (payload) => {
      sendEmail(`Order created #${payload.id} for $${payload.amount}`);
    },
    updated: (payload) => {
      sendEmail(`Order updated #${payload.id} (changes: ${Object.keys(payload.changes).join(', ')})`);
    },
    cancelled: (payload) => {
      sendEmail(`Order cancelled #${payload.id}${payload.reason ? `: ${payload.reason}` : ''}`);
    },
  });
```

## Compile-Time Safety

If someone later adds a new collateral to the `order` axon:

```ts
// New collateral added to order axon
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
  refunded: collateral<{ id: string; amount: number }>(), // NEW!
};
```

TypeScript will immediately error on the `orderMailer` bind:

```ts signature
// ❌ TypeScript Error: Property 'refunded' is missing in type '{ created: ...; updated: ...; cancelled: ...; }'
const orderMailer = neuron({})
  .bind(order, {
    created: (payload) => { /* ... */ },
    updated: (payload) => { /* ... */ },
    cancelled: (payload) => { /* ... */ },
    // Missing 'refunded' handler!
  });
```

You must add the handler:

```ts
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
  refunded: collateral<{ id: string; amount: number }>(),
};

// ✅ Fixed: All collaterals handled
const orderMailer = neuron({})
  .bind(order, {
    created: (payload) => { /* ... */ },
    updated: (payload) => { /* ... */ },
    cancelled: (payload) => { /* ... */ },
    refunded: (payload) => {
      sendEmail(`Order refunded #${payload.id} for $${payload.amount}`);
    },
  });
```

## Shorthand vs Full Dendrite Objects

You can pass either a response function (shorthand) or a full dendrite object per key:

### Shorthand (response function only)

```ts
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
};

const notifier = neuron({})
  .bind(order, {
    created: (payload) => {
      // Just the response function
      notifyUser(payload.id);
    },
    updated: (payload) => {
      notifyUser(payload.id);
    },
    cancelled: (payload) => {
      notifyUser(payload.id);
    },
  });
```

### Full dendrite objects

```ts
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
};

const notifier = neuron({ notified })
  .bind(order, {
    created: {
      collateral: order.created,
      response: async (payload, axon, ctx) => {
        if (ctx.abortSignal?.aborted) return;
        await notifyUser(payload.id);
        // Can emit signals from this neuron's axon
        return axon.notified.createSignal({ id: payload.id });
      },
    },
    updated: {
      collateral: order.updated,
      response: (payload) => {
        notifyUser(payload.id);
      },
    },
    cancelled: (payload) => {
      notifyUser(payload.id);
    },
  });
```

## Type Inference

Payload types are automatically inferred from the axon you're binding to:

```ts
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
};

// payload types are inferred - no need to annotate!
const handler = neuron({})
  .bind(order, {
    created: (payload) => {
      // payload is { id: string; amount: number }
      console.log(payload.id, payload.amount);
    },
    updated: (payload) => {
      // payload is { id: string; changes: Record<string, unknown> }
      console.log(payload.changes);
    },
  });
```

## Real-World Use Cases

### Domain Event Notifiers

Send notifications for every domain event:

```ts
const user = {
  registered: collateral<{ userId: string; email: string }>(),
  verified: collateral<{ userId: string }>(),
  suspended: collateral<{ userId: string; reason: string }>(),
  deleted: collateral<{ userId: string }>(),
};

const userNotifier = neuron({})
  .bind(user, {
    registered: (payload) => sendWelcomeEmail(payload.email),
    verified: (payload) => sendVerificationConfirmation(payload.userId),
    suspended: (payload) => sendSuspensionNotice(payload.userId, payload.reason),
    deleted: (payload) => sendDeletionConfirmation(payload.userId),
  });
```

### Audit Logging

Log every state change:

```ts
const product = {
  created: collateral<{ id: string; name: string }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  priceChanged: collateral<{ id: string; oldPrice: number; newPrice: number }>(),
  deleted: collateral<{ id: string }>(),
};

const auditLogger = neuron({})
  .bind(product, {
    created: (payload) => logAudit('product_created', payload),
    updated: (payload) => logAudit('product_updated', payload),
    priceChanged: (payload) => logAudit('product_price_changed', payload),
    deleted: (payload) => logAudit('product_deleted', payload),
  });
```

### Metrics Collection

Track metrics for all events:

```ts
const payment = {
  initiated: collateral<{ id: string; amount: number }>(),
  processed: collateral<{ id: string; amount: number }>(),
  failed: collateral<{ id: string; reason: string }>(),
  refunded: collateral<{ id: string; amount: number }>(),
};

const metricsCollector = neuron({})
  .bind(payment, {
    initiated: (payload) => metrics.increment('payment.initiated', { amount: payload.amount }),
    processed: (payload) => metrics.increment('payment.processed', { amount: payload.amount }),
    failed: (payload) => metrics.increment('payment.failed', { reason: payload.reason }),
    refunded: (payload) => metrics.increment('payment.refunded', { amount: payload.amount }),
  });
```

## Best Practices

1. **Use for cross-cutting concerns**: Exhaustive binding is ideal for neurons that must react to every event in a domain (notifiers, loggers, metrics, analytics).

2. **Keep handlers focused**: Each handler should have a single responsibility. If you need complex logic, extract it to a separate function.

3. **Return signals when needed**: If your neuron needs to emit follow-up signals, return them from the handler. Otherwise, return `undefined` or nothing.

4. **Leverage type inference**: Don't manually annotate payload types; let TypeScript infer them from the axon.

5. **Data flows through payloads**: All per-run data (including retry counters and correlation IDs) flows through signal payloads; pass dependencies through a [factory function](../core/api.md#dependencies-a-store-a-database-a-clock).

![Eye Wired](/img/skull_wired.png)

## Comparison with Manual Dendrites

Without exhaustive binding, you'd need to manually add each dendrite:

```ts
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
};

// ❌ Manual approach - easy to miss new collaterals
const orderMailer = neuron({})
  .dendrite({ collateral: order.created, response: (p) => { /* ... */ } })
  .dendrite({ collateral: order.updated, response: (p) => { /* ... */ } })
  .dendrite({ collateral: order.cancelled, response: (p) => { /* ... */ } });
  // If order.refunded is added, this won't error - you might miss it!
```

With exhaustive binding:

```ts
const order = {
  created: collateral<{ id: string; amount: number }>(),
  updated: collateral<{ id: string; changes: Record<string, unknown> }>(),
  cancelled: collateral<{ id: string; reason?: string }>(),
};

// ✅ Exhaustive approach - compiler enforces completeness
const orderMailer = neuron({})
  .bind(order, {
    created: (p) => { /* ... */ },
    updated: (p) => { /* ... */ },
    cancelled: (p) => { /* ... */ },
    // If order.refunded is added, TypeScript will error here!
  });
```

## Summary

`neuron.bind()` provides compile-time exhaustiveness checking, ensuring you never miss handling new collaterals when a neuron's axon evolves. This is especially valuable for domain-oriented neurons that must react to every way a record can be created, updated, or changed. The compiler becomes your safety net, preventing incomplete implementations before they reach production.

