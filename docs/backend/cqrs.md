---
id: backend-cqrs
title: CQRS Patterns
sidebar_label: CQRS Patterns
slug: /backend/cqrs
description: Explore CQRS patterns with CNStra. Learn how to separate commands and queries using CNStra's architecture.
keywords: [CQRS, command query responsibility segregation, architecture patterns, commands, queries]
---

CNStra's architecture naturally supports Command Query Responsibility Segregation (CQRS) patterns. The separation between commands (signals that trigger neurons) and queries (reading from external stores) aligns well with CQRS principles. **Note**: Context stores per-neuron per-stimulation metadata, not business aggregates.

### CQRS with CNStra

```typescript
import { CNS, neuron, collateral } from '@cnstra/core';

// Command side: Write operations
// Note: In real CQRS, aggregates would be stored in a database, not context
// Context here is only for per-neuron per-stimulation metadata

const createUserCommand = collateral<{ name: string; email: string }>('createUserCommand');
const userCreated = collateral<{ id: string; name: string; email: string; createdAt: number }>('userCreated');

// Command handlers (write side)
const userCommandHandler = neuron('userCommandHandler', { userCreated }).dendrite({
  collateral: createUserCommand,
  response: async (payload, axon) => {
    // Execute command and create aggregate
    // In production, this would persist to a database
    const userId = generateId();
    const newAggregate = {
      id: userId,
      name: payload.name,
      email: payload.email,
      createdAt: Date.now(),
    };
    
    // Emit event (could trigger query side updates)
    return axon.userCreated.createSignal(newAggregate);
  },
});

// Query side: Read operations (would typically read from a separate read model/store)
const getUserQuery = collateral<{ id: string }>('getUserQuery');
const userQueryResult = collateral<{ id: string; name: string; email: string; createdAt: number }>('userQueryResult');

const userQueryHandler = neuron('userQueryHandler', { userQueryResult }).dendrite({
  collateral: getUserQuery,
  response: async (payload, axon) => {
    // In real CQRS, this would read from a read model/database
    // Context is not used for business aggregates
    const aggregate = await readModel.getUser(payload.id);
    
    if (!aggregate) {
      throw new Error('User not found');
    }
    
    return axon.userQueryResult.createSignal(aggregate);
  },
});

const cns = new CNS([userCommandHandler, userQueryHandler]);

// Command: Write operation
await cns.stimulate(createUserCommand.createSignal({
  name: 'John Doe',
  email: 'john@example.com',
}));

// Query: Read operation (separate from write path)
const queryStimulation = cns.stimulate(getUserQuery.createSignal({ id: 'user-123' }));
await queryStimulation.waitUntilComplete();
```

### Read Model Projection

In canonical CQRS, read models are updated asynchronously by separate projection neurons that listen to events. This ensures true separation between write and read stores:

```typescript
// Command side: Write operations
const createUserCommand = collateral<{ name: string; email: string }>('createUserCommand');
const userCreated = collateral<{ id: string; name: string; email: string; createdAt: number }>('userCreated');

const userCommandHandler = neuron('userCommandHandler', { userCreated }).dendrite({
  collateral: createUserCommand,
  response: async (payload, axon) => {
    // Write to command/write database (source of truth)
    const userId = generateId();
    await writeDb.users.create({
      id: userId,
      name: payload.name,
      email: payload.email,
      createdAt: Date.now(),
    });
    
    // Emit event (triggers read model projection asynchronously)
    return axon.userCreated.createSignal({ 
      id: userId, 
      name: payload.name, 
      email: payload.email, 
      createdAt: Date.now() 
    });
  },
});

// Read model projection: Updates read model from events
const readModelUpdated = collateral<{ userId: string }>('readModelUpdated');

const readModelProjection = neuron('readModelProjection', { readModelUpdated }).dendrite({
  collateral: userCreated,
  response: async (payload, axon) => {
    // Update read model (separate database/store) from event
    // Read model might have denormalized data, different structure, etc.
    await readModel.users.upsert({
      id: payload.id,
      name: payload.name,
      email: payload.email,
      createdAt: payload.createdAt,
      // Additional denormalized fields for read optimization
      displayName: `${payload.name} (${payload.email})`,
    });
    
    // Emit signal after read model update is complete
    return axon.readModelUpdated.createSignal({ userId: payload.id });
  },
});

const cns = new CNS([userCommandHandler, readModelProjection]);

// Command writes to write database
const stimulation = cns.stimulate(createUserCommand.createSignal({
  name: 'John Doe',
  email: 'john@example.com',
}), {
  onResponse: async (response) => {
    // After read model update is complete, read from read model
    if (response.outputSignal?.collateralName === 'readModelUpdated') {
      const userId = response.outputSignal.payload.userId;
      
      // Read from read model (different database/store)
      // Now we know read model is updated, safe to read
      const userFromReadModel = await readModel.getUser(userId);
      
      if (userFromReadModel) {
        // Use read model data for side effects (notifications, webhooks, etc.)
        await sendWelcomeEmail(userFromReadModel.email, userFromReadModel.displayName);
        await logUserCreated(userFromReadModel);
      }
    }
  }
});

await stimulation.waitUntilComplete();

// Read model is updated asynchronously by projection neuron
// Queries read from read model independently
```

**Key points:**
- **Command writes to write database** - `writeDb` stores the source of truth
- **Event triggers projection** - `userCreated` event triggers read model update
- **Separate projection neuron** - Updates read model asynchronously, independent from command
- **Different stores** - Write and read operations use completely separate databases/stores
- **Eventual consistency** - Read model is updated asynchronously, queries may see slightly stale data

**Key points:**
- **Command writes to write database** - `writeDb` stores the source of truth
- **Event triggers projection** - `userCreated` event triggers read model update
- **Projection emits completion signal** - After upsert, `readModelUpdated` signal is emitted
- **Read from read model in `onResponse`** - Once `readModelUpdated` is received, read model is guaranteed to be updated
- **Different stores** - Write and read operations use completely separate databases/stores
- **Side effects** - Use `onResponse` for notifications, webhooks, logging with read model data

### CQRS Benefits with CNStra

- **Clear separation**: Commands and queries are naturally separated through different collaterals and neurons
- **Event sourcing potential**: Each command can emit events that update read models
- **Scalability**: Command and query sides can be scaled independently
- **Type safety**: Full type safety for both commands and queries

### Advanced CQRS Patterns

CNStra can support more advanced CQRS patterns:

- **Event sourcing**: Store all commands as events and rebuild aggregates from events
- **Read model projections**: Use neurons to project events into read models
- **Saga orchestration**: Coordinate multiple aggregates through CNStra workflows
- **Eventual consistency**: Handle eventual consistency between command and query sides

## See Also

- [Message Brokers Integration](/docs/integrations/message-brokers) - Retry patterns and context preservation with message brokers
- [Backend Overview](/docs/backend/overview) - General backend orchestration patterns

