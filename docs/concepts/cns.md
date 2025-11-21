---
id: cns
title: CNS - Central Neural Network of Your App
sidebar_label: CNS
slug: /concepts/cns
description: Discover CNS (Central Neural Network of your app), CNStra's architectural approach for building complex, highly scalable apps, explicit orchestration, and clean separation of responsibilities.
keywords: [CNS, Central Neural Network, architecture, design pattern, state machine architecture, explicit flow control, SOLID principles, SRP, single responsibility, Redux comparison, Flux comparison, event-driven vs explicit, saga pattern, state machine pattern, graph-based architecture]
---

CNS is the Central Neural Network of your app. It's the core execution model of CNStra and the reason you can keep complex business flows understandable, testable, and safe to refactor even as your app and team grow.

If you've ever felt that adding one more feature might break three others, or that "just wiring this flow together" turned into a fragile mess of callbacks, controllers, and effects, CNS is designed to remove that pain.

## What Problem Does CNS Solve?

Before talking about graphs and neurons, it's important to be clear on the core pain: **how do you keep business flows understandable and safe to change as your system and team scale?**

CNS is a response to the limitations of the mainstream architectures below.

### MVC and Scalability

Traditional MVC architectures suffer from a fundamental scalability issue: complex interconnections between models and controllers create tight coupling that becomes increasingly difficult to manage as applications grow. This is the same problem that Facebook engineers identified when they introduced Flux—the intricate web of dependencies between models and controllers makes it hard to reason about data flow, test components in isolation, and scale the application architecture.

As the codebase grows you typically see:

- Hidden data flows between controllers, services, and models
- "God" services or controllers that know too much
- Fear of refactoring because you can't see all the places a change will hit
- Slow onboarding for new engineers who need to mentally reconstruct the architecture from scattered code

That's the pain CNS is built to solve.

## Existing Solutions and Their Limitations

### Flux and Redux: Partial Solutions

Flux and Redux approaches partially addressed the MVC problem by introducing unidirectional data flow and centralized state management. However, they failed to provide a true orchestration system: you still have to manually coordinate related models and side effects, especially in complex workflows or offline applications where you need to coordinate multiple asynchronous operations, handle partial failures, and manage state consistency across disconnected scenarios. You get a better state container, but not a reliable way to express and control business flows end‑to‑end.

### Event-Driven Architectures: Orchestration Complexity

Event-based approaches can solve coordination problems of any complexity through message passing, but they require extensive manual work for management. Without proper control, they easily turn into chaos: subscriptions are scattered across the codebase, making it impossible to see who subscribes to what without searching everywhere. There's no way to track when a complex operation completes—if at least one listener emits asynchronously without awaiting, you can't determine when the process has finished. Most event-driven systems don't even provide an API for waiting on completion. In the simplest synchronous systems, you can hit call stack limits when trying to coordinate complex flows.

### Flow Engines: Scaling Without Dependency Inversion

Flow engines typically work through direct function calls, which creates scaling problems:
- **Tight coupling and poor scalability**: Direct calls create hard dependencies without proper abstraction. You must manually locate all call sites when refactoring, making the system brittle and difficult to evolve as it grows.
- **State synchronization overhead**: Often requires significant overhead for state synchronization, which complicates throughput and performance.
- **Limited flexibility**: The system offers little freedom and customization options—it's almost non-customizable.

The result is a system that "works" at small scale but becomes increasingly risky and expensive to change as features and teams grow.

## How CNStra Addresses These Limitations

CNS addresses the limitations of MVC, Flux/Redux, event buses, and ad‑hoc flow engines by combining **explicit orchestration, structural typing, and deterministic graph traversal** into a single, coherent execution model:

- **Explicit graph structure**: All subscriptions are visible in one place—the graph is a first-class data structure that can be analyzed, not scattered across the codebase
- **Ownership guarantees**: Neurons can only emit their own collaterals, enforced by TypeScript at compile time—no global "emit" that anyone can call
- **Trackable operation completion**: Built-in completion tracking with `await stimulation.waitUntilComplete()`—you know exactly when all handlers finished
- **Isolated execution**: Each stimulation creates an independent execution context—parallel requests don't interfere, and you can cancel specific workflows independently
- **Compile-time type safety**: Structural typing ensures payload types match everywhere—broken bindings fail fast at compile time, not at runtime
- **Dependency inversion**: Proper abstraction through collaterals and dendrites—refactoring doesn't require manually locating all call sites
- **High flexibility**: You control the system and can execute any combinations of stimulations within your own tools

## Neuron as a State Machine

A neuron can be viewed as a small state machine:
- Inputs (dendrites) are state triggers
- Returned signals are transitions (next states on the axon)
- The neuron owns its transitions: it emits only its own axon collaterals

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

At graph level, composing such neurons yields a larger, explicit state machine with type-safe transitions between collaterals.

## Summary and What to Read Next

CNS gives you a way to **model complex business flows as an explicit, type‑safe graph** instead of an invisible web of controllers, effects, and event handlers.

To go deeper:

- **Concepts**: start with the high‑level `Basics` of CNStra to understand the core design decisions behind the runtime: [Basics](/concepts/basics).
- **API**: see how neurons, collaterals, signals, and stimulations are defined in code: [API Reference](/core/api).
- **Recipes**: explore concrete flow patterns built on CNS—for example, cycles via self‑loops: [Self‑loops and cycles](/recipes/self-loop-cycles).

