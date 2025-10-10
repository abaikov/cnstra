---
id: ierg
title: IERG - Inverted Explicit Reactive Graph Architecture
sidebar_label: IERG
slug: /concepts/ierg
description: Learn about IERG (Inverted Explicit Reactive Graph), CNStra's architectural approach. Understand deterministic state machines, explicit flow control, SOLID/SRP principles, and how IERG differs from Flux, Redux, and event-driven architectures.
keywords: [IERG, inverted explicit reactive graph, architecture, design pattern, state machine architecture, explicit flow control, deterministic orchestration, SOLID principles, SRP, single responsibility, Redux comparison, Flux comparison, event-driven vs explicit, saga pattern, state machine pattern, graph-based architecture]
---

IERG stands for Inverted Explicit Reactive Graph. It’s the core execution model of CNStra.

What it is
- Inverted: you explicitly start a run (stimulate), CNS walks the graph. Nothing happens in the background until you ask for it.
- Explicit: every continuation is returned explicitly from a dendrite. No ambient listeners, no hidden subscriptions.
- Reactive Graph: typed collaterals connect neurons; responses form a deterministic traversal.

Not an event bus
- No global “emit”. A neuron may only emit collaterals declared in its own axon (signal ownership).
- You don’t need unique event IDs to ensure “the event is mine” — you bind to exact collaterals, not stringly-named topics floating around.
- No race for who hears what; the next step is whatever you return.

SRP and architecture clarity
- Actors are visible: controller neurons orchestrate; domain neurons do one thing well.
- Single Responsibility Principle is easier to uphold: each neuron handles exactly one input collateral and returns exactly one continuation (or none).
- Ownership is clear: producers emit their own collaterals; consumers bind via dendrites.

Determinism and debuggability
- Runs are hop-bounded and deterministic; the same input gives the same path.
- Traces are easy to follow: collateral → dendrite → returned signal, step by step.
- No “who subscribed where?” scavenger hunts; flows are local and type-checked.

No unique event IDs
- Because routing is explicit, you don’t need ad‑hoc event IDs to filter “your” messages.
- The binding is structural (collateral types), not heuristic (string/topic + ID dance).

Testing and refactoring
- Neurons are small pure(ish) functions with typed IO → unit testing is trivial.
- Changing a collateral signature propagates via types; broken bindings fail fast at compile time.
- Controller neurons allow refactoring of orchestration without touching domain logic.

Performance and backpressure
- No full state tree copies; responses are local and O(1) dispatch along the graph.
- Built-in concurrency gates and AbortSignal support provide backpressure knobs.

Entry point and cross‑cutting concerns
- Single entry point: `cns.stimulate(...)` starts every run.
- Cross‑cutting hooks: use global `addResponseListener(...)` or per‑run `onResponse` to implement logging/metrics/tracing without polluting domain neurons.

Comparison to Flux/Redux
- Flux relies on global dispatch and slice reducers; cross-slice coordination and ordering are awkward.
- Immutable tree copies cause extra allocations and render churn.
- IERG replaces this with explicit sequencing and local continuation, keeping state changes minimal and predictable.

Tiny example

```ts
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';

const start = collateral<{ q: string }>('search:start');
const fetched = collateral<{ q: string; items: any[] }>('search:fetched');

const controller = withCtx<{ q?: string }>()
  .neuron('controller', { fetched })
  .dendrite({
    collateral: start,
    response: async (payload, axon, ctx) => {
      ctx.set({ q: payload.q });
      const items = await api.search(payload.q);
      return axon.fetched.createSignal({ q: payload.q, items });
    },
  });

const render = neuron('render', {}).dendrite({
  collateral: fetched,
  response: ({ items }) => { view.render(items); },
});

new CNS([controller, render]);
```

Key takeaways
- Start runs explicitly; return next steps explicitly.
- Bind to collaterals, not topic strings; no unique event IDs needed.
- Keep orchestration in controllers, domain work in domain neurons.
- Deterministic, testable, type-safe, and fast.

## Flow: short‑lived vs long‑lived sagas

Short‑lived (single stimulation)
- One explicit `stimulate(...)` triggers a complete deterministic run.
- Ideal for user actions and bounded workflows (validate → fetch → render).
- Use `AbortSignal` for graceful cancel; use `ctx` for per‑run data.

Long‑lived (multi‑stimulation)
- A saga that spans time is implemented by re‑stimulating on external events (queues, cron, webhooks, timers).
- Keep a correlation id in payload/context; persist progress in OIMDB or a DB.
- No global listeners: the “continuation” is a new explicit `stimulate(...)` when the event arrives.

Example (long‑lived via queue)

```ts
// When a message arrives later, explicitly continue the saga
queue.on('message', async (m) => {
  await cns.stimulate(orderPaymentReceived.createSignal({ orderId: m.id }));
});
```

This keeps orchestration explicit and observable, without hidden subscriptions.

## Neuron as a state machine

A neuron can be viewed as a small state machine:
- Inputs (dendrites) are state triggers.
- Returned signals are transitions (next states on the axon).
- The neuron owns its transitions: it emits only its own axon collaterals.

```ts
const order = {
  reserved: collateral<{ id: string }>('order:reserved'),
  charged: collateral<{ id: string }>('order:charged'),
  failed: collateral<{ id: string; reason: string }>('order:failed'),
};

const payment = neuron('payment', order)
  .dendrite({
    collateral: order.reserved,
    response: async (p, axon) => {
      const ok = await payments.charge(p.id);
      return ok
        ? axon.charged.createSignal({ id: p.id })
        : axon.failed.createSignal({ id: p.id, reason: 'card_declined' });
    },
  });
```

At graph level, composing such neurons yields a larger, explicit state machine with deterministic transitions between collaterals.
