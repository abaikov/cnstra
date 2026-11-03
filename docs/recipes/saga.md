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

```ts file=saga.ts
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';

declare const inventory: { reserve(id: string): Promise<boolean>; release(id: string): Promise<void> };
declare const payments: { charge(id: string): Promise<boolean> };

// Domain collaterals
export const order = {
  created: cnsCollateral<{ id: string }>(),
  reserved: cnsCollateral<{ id: string }>(),
  charged: cnsCollateral<{ id: string }>(),
  confirmed: cnsCollateral<{ id: string }>(),
  reservationFailed: cnsCollateral<{ id: string; reason: string }>(),
  paymentFailed: cnsCollateral<{ id: string; reason: string }>(),
  compensated: cnsCollateral<{ id: string }>(),
  paidExternally: cnsCollateral<{ id: string }>(),
};

// Reserve inventory → emits reserved/reservationFailed (owned by reservation)
export const reservation = cnsNeuron({
  reserved: order.reserved,
  reservationFailed: order.reservationFailed,
}).dendrite({
  collateral: order.created,
  response: async (p, axon) => {
    const ok = await inventory.reserve(p.id);
    return ok
      ? axon.reserved.createSignal({ id: p.id })
      : axon.reservationFailed.createSignal({ id: p.id, reason: 'no_stock' });
  },
});

// Charge payment → emits charged/paymentFailed; compensates its own failure (releases stock)
export const payment = cnsNeuron({
  charged: order.charged,
  paymentFailed: order.paymentFailed,
  compensated: order.compensated,
})
  .dendrite({
    collateral: order.reserved,
    response: async (p, axon) => {
      const ok = await payments.charge(p.id);
      return ok
        ? axon.charged.createSignal({ id: p.id })
        : axon.paymentFailed.createSignal({ id: p.id, reason: 'card_declined' });
    },
  })
  .dendrite({
    collateral: order.paymentFailed,
    response: async (p, axon) => {
      await inventory.release(p.id);
      return axon.compensated.createSignal({ id: p.id });
    },
  });

// Confirm order → emits confirmed, whether the charge or an external payment paid it
export const confirmation = cnsNeuron({
  confirmed: order.confirmed,
})
  .dendrite({
    collateral: order.charged,
    response: (p, axon) => axon.confirmed.createSignal({ id: p.id }),
  })
  .dendrite({
    collateral: order.paidExternally,
    response: (p, axon) => axon.confirmed.createSignal({ id: p.id }),
  });

// Wire and run
const cns = new CNS([reservation, payment, confirmation]);
await cns.stimulate(order.created.createSignal({ id: 'o1' })).waitUntilComplete();
```

Long‑lived saga (multiple stimulations over time)
- Re‑stimulate when an external event arrives (queue/webhook/cron/socket).
- Use a small bridge neuron to map external events into domain collaterals (ownership preserved).

```ts file=saga-bridge.ts
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { order, reservation, payment, confirmation } from './saga';

declare const queue: { on(event: string, handler: (message: { orderId: string }) => Promise<void>): void };

const paymentReceivedExternal = cnsCollateral<{ id: string }>();

// Bridge: converts the external event into its own domain collateral "paidExternally"
export const paymentBridge = cnsNeuron({ paidExternally: order.paidExternally })
  .dendrite({
    collateral: paymentReceivedExternal,
    response: (p, axon) => axon.paidExternally.createSignal({ id: p.id }),
  });

const cns = new CNS([reservation, payment, confirmation, paymentBridge]);

// First run
await cns.stimulate(order.created.createSignal({ id: 'o1' })).waitUntilComplete();

// Later, on external event
queue.on('payment_received', async (m) => {
  await cns.stimulate(paymentReceivedExternal.createSignal({ id: m.orderId })).waitUntilComplete();
});
```

Notes
- No function-passing neurons: use `cnsNeuron(axon).dendrite({ collateral, response })`.
- Ownership: a collateral belongs to exactly one neuron's axon — `new CNS` throws when two neurons hold the same one. Other neurons listen via dendrites; a listener that joins several sources has one dendrite per source.
- Compensation is modeled as explicit branches; cancellation via `AbortSignal` if needed.
