---
id: saga
title: Saga Pattern Implementation with CNStra - Long-Running Workflows
sidebar_label: Saga
slug: /recipes/saga
description: Implement saga pattern with CNStra for long-running, distributed workflows. Learn short-lived vs long-lived sagas, compensation logic, error handling, and external event triggers for Node.js backends and microservices.
keywords: [saga pattern, saga orchestration, distributed saga, compensation logic, long-running workflows, distributed transactions, microservices saga, event-driven saga, workflow coordination, process manager, choreography vs orchestration, eventual consistency, rollback logic, error recovery, event sourcing saga]
---

Model long-running, multi-step reactions with explicit branches and cancel hooks.

Short‑lived saga (single stimulation)
- Entire flow completes within one `stimulate(...)` run.
- Each neuron emits only its own axon collaterals (signal ownership).

```ts
import { CNS, collateral, neuron } from '@cnstra/core';

// Domain collaterals
const order = {
  created: collateral<{ id: string }>('order:created'),
  reserved: collateral<{ id: string }>('order:reserved'),
  charged: collateral<{ id: string }>('order:charged'),
  confirmed: collateral<{ id: string }>('order:confirmed'),
  failed: collateral<{ id: string; reason?: string }>('order:failed'),
  compensated: collateral<{ id: string }>('order:compensated'),
};

// Reserve inventory → emits reserved/failed (owned by reservation)
export const reservation = neuron('reservation', {
  reserved: order.reserved,
  failed: order.failed,
}).dendrite({
  collateral: order.created,
  response: async (p, axon) => {
    const ok = await inventory.reserve(p.id);
    return ok
      ? axon.reserved.createSignal({ id: p.id })
      : axon.failed.createSignal({ id: p.id, reason: 'no_stock' });
  },
});

// Charge payment → emits charged/failed; also compensates on failure (releases stock)
export const payment = neuron('payment', {
  charged: order.charged,
  failed: order.failed,
  compensated: order.compensated,
})
  .dendrite({
    collateral: order.reserved,
    response: async (p, axon) => {
      const ok = await payments.charge(p.id);
      return ok
        ? axon.charged.createSignal({ id: p.id })
        : axon.failed.createSignal({ id: p.id, reason: 'card_declined' });
    },
  })
  .dendrite({
    collateral: order.failed,
    response: async (p, axon) => {
      await inventory.release(p.id);
      return axon.compensated.createSignal({ id: p.id });
    },
  });

// Confirm order → emits confirmed
export const confirmation = neuron('confirmation', {
  confirmed: order.confirmed,
}).dendrite({
  collateral: order.charged,
  response: (p, axon) => axon.confirmed.createSignal({ id: p.id }),
});

// Wire and run
const cns = new CNS([reservation, payment, confirmation]);
await cns.stimulate(order.created.createSignal({ id: 'o1' }));
```

Long‑lived saga (multiple stimulations over time)
- Re‑stimulate when an external event arrives (queue/webhook/cron/socket).
- Use a small bridge neuron to map external events into domain collaterals (ownership preserved).

```ts
const paymentReceivedExternal = collateral<{ id: string }>('ext:payment-received');

// Bridge: converts external event into domain "charged" (owned by this bridge)
export const paymentBridge = neuron('payment-bridge', { charged: order.charged })
  .dendrite({
    collateral: paymentReceivedExternal,
    response: (p, axon) => axon.charged.createSignal({ id: p.id }),
  });

const cns = new CNS([reservation, payment, confirmation, paymentBridge]);

// First run
await cns.stimulate(order.created.createSignal({ id: 'o1' }));

// Later, on external event
queue.on('payment_received', async (m) => {
  await cns.stimulate(paymentReceivedExternal.createSignal({ id: m.orderId }));
});
```

Notes
- No function-passing neurons: use `neuron(name, axon).dendrite({ collateral, response })`.
- Ownership: a neuron may emit only its axon collaterals; other neurons listen via dendrites.
- Compensation is modeled as explicit branches; cancellation via `AbortSignal` if needed.
