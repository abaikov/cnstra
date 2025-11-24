---
id: basics
title: Basics - Core Design Principles
sidebar_label: Basics
slug: /concepts/basics
description: "Learn the fundamental design principles of CNStra: single-process stimulation execution, command pattern architecture with built-in dependency injection, and the separation of concerns between data mutations and reads."
keywords: [basics, fundamentals, design principles, single process, command pattern, dependency injection, data mutations, data reads, domain neurons, architecture basics, CNStra principles]
---

## Single-Process Stimulation Execution

Stimulation lives in a single process to guarantee stable execution without unnecessary overhead. This design choice ensures:

- **Deterministic execution**: All neurons within a stimulation run in the same execution context, eliminating cross-process synchronization complexity
- **Performance**: No serialization/deserialization overhead for signal passing between neurons
- **Reliability**: Single-process execution reduces failure modes and makes error handling straightforward

### Multi-Process Architecture

For multi-process scenarios, CNStra doesn't prescribe a specific inter-process communication mechanism. Instead, you choose the approach that best fits your needs:

- **Message queues**: Use RabbitMQ, AWS SQS, BullMQ, or any other message broker to coordinate between different CNS instances
- **HTTP/gRPC**: Communicate between CNS instances via standard web protocols
- **Event sourcing**: Share events through an event store that multiple CNS instances can consume
- **Database**: Use database triggers or polling to coordinate between processes

Each CNS instance handles its own stimulations independently, and you orchestrate communication between instances using your preferred mechanism. This flexibility allows you to scale horizontally while maintaining the simplicity and reliability of single-process stimulation execution.

## Command Pattern with Built-in Dependency Injection

CNStra implements a large-scale command pattern where each stimulation is a command that gets processed by many processors (neurons). This architecture provides dependency injection out of the box:

- **Stimulations as commands**: When you call `cns.stimulate(signal)`, you're issuing a command that flows through the neuron graph
- **Multiple processors**: Each neuron that binds to the signal's collateral becomes a processor for that command
- **Automatic wiring**: The dependency graph is explicit and type-safe—neurons declare their dependencies (dendrites) and outputs (collaterals), and CNStra automatically routes signals between them
- **No manual DI setup**: You don't need to configure dependency injection containers or manually wire dependencies—the graph structure itself defines the dependencies

This approach combines the benefits of the command pattern (encapsulation, decoupling, extensibility) with automatic dependency resolution through the explicit neuron graph structure.

```ts
// Each stimulation is a command
const signal = orderCreated.createSignal({ orderId: '123' });

// Multiple neurons process this command automatically
// - inventory neuron: reserves items
// - payment neuron: validates payment method
// - notification neuron: sends confirmation email
// All wired automatically through the graph structure
await cns.stimulate(signal);
```

## Separation of Concerns: Mutations vs Reads

A common pain point in applications is tracking sources of data changes. While reading data in a unified format is relatively straightforward to set up, managing where and how data gets modified is much more challenging.

### Domain Neurons for Data Mutations

CNStra recommends organizing **domain neurons** to handle model changes. These neurons:

- Own the responsibility for mutating specific domain models
- Provide a single source of truth for how data changes
- Make data mutation flows explicit and traceable
- Enable easy testing and validation of business rules

By centralizing mutations in domain neurons, you eliminate the "where did this data come from?" problem. Every change flows through explicit, typed signals that you can trace through the graph.

### Reading Data Through Your Own System

For reading models, CNStra suggests allowing reads everywhere through your own system:

- **Flexible read access**: Components, services, and neurons can read data using whatever mechanism fits your architecture (direct database queries, read models, caches, etc.)
- **No CNStra coupling**: Reading doesn't need to go through CNStra—use your existing data access patterns
- **Optimization freedom**: Choose the most efficient read mechanism for each use case (indexed queries, materialized views, in-memory caches, etc.)

This separation provides the best of both worlds:
- **Mutations are controlled and explicit** through domain neurons, making data changes traceable and testable
- **Reads are flexible and optimized** through your own data access layer, avoiding unnecessary overhead

### Example Pattern

```ts
// Domain neuron: owns mutations for Order model
const orderDomain = neuron('order:domain', {
  created: collateral<{ id: string; items: Item[] }>('order:created'),
  updated: collateral<{ id: string; changes: Partial<Order> }>('order:updated'),
  cancelled: collateral<{ id: string; reason: string }>('order:cancelled'),
})
  .dendrite({
    collateral: createOrder,
    response: async (payload, axon) => {
      // Single source of truth for order creation
      const order = await db.orders.create(payload);
      return axon.created.createSignal({ id: order.id, items: order.items });
    },
  });

// Reading can happen anywhere, using your preferred method
class OrderService {
  async getOrder(id: string) {
    // Direct read - no CNStra needed
    return await db.orders.findById(id);
  }
  
  async listOrders(filters: OrderFilters) {
    // Optimized query - your choice of implementation
    return await db.orders.findMany(filters);
  }
}
```

This pattern ensures that:
- All order mutations flow through the `orderDomain` neuron (traceable, testable)
- Order reads use the most efficient method for each use case (flexible, optimized)
- The system remains maintainable as it grows (clear separation of concerns)

