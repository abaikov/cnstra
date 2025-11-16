---
id: backend-development-patterns
title: Development Patterns, Checkpointing, and CQRS
sidebar_label: Development & Checkpointing
slug: /backend/development-patterns
description: Use CNStra for development to preserve bindings, implement checkpointing for retryable flows, and explore CQRS patterns. Learn how to save state at any moment and resume from checkpoints.
keywords: [development patterns, checkpointing, state preservation, retryable flows, persistent workflows, CQRS, development bindings, state snapshots, workflow state, retry patterns, state management]
---

CNStra provides powerful patterns for backend development, allowing you to preserve state during development, implement checkpointing for retryable and persistent flows, and explore CQRS architectures.

## Development: Keep Your Bindings Alive

During backend development, you often work with complex workflows that involve multiple steps and intermediate state. CNStra allows you to keep all your bindings and intermediate results without losing anything, making development and debugging much easier.

### Preserving State During Development

With CNStra, you can maintain the full state of your stimulation throughout development:

```typescript
import { CNS } from '@cnstra/core';
import { withCtx, collateral } from '@cnstra/core';

const ctxBuilder = withCtx<{ 
  processedItems: string[];
  metadata: Record<string, unknown>;
}>();

const input = collateral<{ id: string }>('input');
const step1Out = collateral<{ id: string; processed: boolean }>('step1Out');
const step2Out = collateral<{ id: string; result: string }>('step2Out');

const step1 = ctxBuilder.neuron('step1', { step1Out }).dendrite({
  collateral: input,
  response: async (payload, axon, ctx) => {
    // All state is preserved in context
    const current = ctx.get() || { processedItems: [], metadata: {} };
    ctx.set({
      processedItems: [...current.processedItems, payload.id],
      metadata: { ...current.metadata, [payload.id]: { timestamp: Date.now() } }
    });
    
    // Your processing logic
    return axon.step1Out.createSignal({ 
      id: payload.id, 
      processed: true 
    });
  },
});

const step2 = ctxBuilder.neuron('step2', { step2Out }).dendrite({
  collateral: step1Out,
  response: async (payload, axon, ctx) => {
    // Access preserved state from previous steps
    const state = ctx.get();
    console.log('Processed items so far:', state?.processedItems);
    
    return axon.step2Out.createSignal({ 
      id: payload.id, 
      result: `Processed: ${payload.id}` 
    });
  },
});

const cns = new CNS([step1, step2]);

// During development, you can inspect the full state at any time
const stimulation = cns.stimulate(input.createSignal({ id: 'item-1' }));

// Access context to see all preserved state
stimulation.getContext().getAll(); // Full state map
stimulation.getContext().get('step1'); // State for specific neuron

await stimulation.waitUntilComplete();
```

**Benefits:**
- No data loss during development iterations
- Full visibility into workflow state at any point
- Easy debugging with complete context
- State persists across development sessions when combined with persistence layers

## Checkpointing for Retryable and Persistent Flows

As demonstrated in the [BullMQ integration example](/docs/integrations/bullmq), CNStra allows you to create checkpoints at any moment and save the complete state for retryable and persistent flows. This is essential for long-running workflows that may be interrupted by crashes, timeouts, or system restarts.

### Creating Checkpoints

You can save the complete state of a stimulation at any point:

```typescript
import { Queue, Worker, Job } from 'bullmq';
import { CNS } from '@cnstra/core';
import { withCtx, collateral } from '@cnstra/core';

const ctxBuilder = withCtx<{ 
  checkpoint: number;
  processedData: unknown[];
}>();

const input = collateral<{ data: unknown }>('input');
const output = collateral<{ result: unknown }>('output');

const processData = ctxBuilder.neuron('processData', { output }).dendrite({
  collateral: input,
  response: async (payload, axon, ctx) => {
    const current = ctx.get() || { checkpoint: 0, processedData: [] };
    
    // Process data
    const processed = await expensiveOperation(payload.data);
    
    // Update checkpoint
    ctx.set({
      checkpoint: current.checkpoint + 1,
      processedData: [...current.processedData, processed]
    });
    
    return axon.output.createSignal({ result: processed });
  },
});

const cns = new CNS([processData]);

const worker = new Worker('workflows', async (job: Job) => {
  const { signal } = job.data;
  
  const savedProgress = job.progress as {
    context?: Record<string, unknown>;
    failedTasks?: Array<{ task: unknown; error: unknown }>;
  } | undefined;
  
  let stimulation;
  
  // Resume from checkpoint if retrying
  if (savedProgress?.context && job.attemptsMade > 0) {
    const failedTasks = savedProgress.failedTasks?.map(ft => ft.task) || [];
    
    stimulation = cns.activate(failedTasks, {
      contextValues: savedProgress.context,
      onResponse: (response) => {
        // Create checkpoint on each response
        const checkpoint = {
          context: stimulation.getContext().getAll(),
          failedTasks: stimulation.getFailedTasks().map(ft => ({
            task: ft.task,
            error: {
              message: ft.error.message,
              name: ft.error.name,
              stack: ft.error.stack,
            },
            aborted: ft.aborted,
          })),
          timestamp: Date.now(),
        };
        
        // Save checkpoint to BullMQ job progress
        job.updateProgress(checkpoint);
      },
    });
  } else {
    // First attempt: start fresh
    stimulation = cns.stimulate(signal, {
      onResponse: (response) => {
        // Optional: create checkpoint on every response
        // (consider performance implications for high-frequency workflows)
        if (shouldCreateCheckpoint(response)) {
          const checkpoint = {
            context: stimulation.getContext().getAll(),
            failedTasks: stimulation.getFailedTasks(),
            timestamp: Date.now(),
          };
          job.updateProgress(checkpoint);
        }
      },
    });
  }
  
  try {
    await stimulation.waitUntilComplete();
  } catch (error) {
    // Save final checkpoint before retry
    const finalCheckpoint = {
      context: stimulation.getContext().getAll(),
      failedTasks: stimulation.getFailedTasks().map(ft => ({
        task: ft.task,
        error: {
          message: ft.error.message,
          name: ft.error.name,
          stack: ft.error.stack,
        },
        aborted: ft.aborted,
      })),
    };
    
    await job.updateProgress(finalCheckpoint);
    throw error; // Trigger BullMQ retry
  }
});
```

### Key Checkpointing Features

- **`stimulation.getContext().getAll()`** - Captures the complete state of all neurons
- **`stimulation.getFailedTasks()`** - Returns all tasks that failed or were aborted
- **`cns.activate()`** - Resumes execution from specific failed tasks with restored context
- **Flexible checkpoint timing** - Create checkpoints on errors, at specific milestones, or on every response

### Checkpointing Strategies

1. **Error-based checkpoints**: Save state only when errors occur (recommended for most cases)
2. **Milestone checkpoints**: Save state at specific workflow milestones
3. **Periodic checkpoints**: Save state at regular intervals
4. **Response-based checkpoints**: Save state on every response (use with caution due to performance implications)

## CQRS Potential

CNStra's architecture naturally supports Command Query Responsibility Segregation (CQRS) patterns. The separation between commands (signals that trigger neurons) and queries (reading state from context or collateral) aligns well with CQRS principles.

### CQRS with CNStra

```typescript
import { CNS } from '@cnstra/core';
import { withCtx, collateral } from '@cnstra/core';

// Command side: Write operations
const ctxBuilder = withCtx<{
  commands: Array<{ id: string; type: string; payload: unknown }>;
  aggregates: Record<string, unknown>;
}>();

const createUserCommand = collateral<{ name: string; email: string }>('createUserCommand');
const updateUserCommand = collateral<{ id: string; updates: Record<string, unknown> }>('updateUserCommand');

// Command handlers (write side)
const userCommandHandler = ctxBuilder.neuron('userCommandHandler', {}).dendrite({
  collateral: createUserCommand,
  response: async (payload, axon, ctx) => {
    const state = ctx.get() || { commands: [], aggregates: {} };
    
    // Execute command and update aggregate
    const userId = generateId();
    const newAggregate = {
      id: userId,
      name: payload.name,
      email: payload.email,
      createdAt: Date.now(),
    };
    
    ctx.set({
      commands: [...state.commands, { 
        id: userId, 
        type: 'createUser', 
        payload 
      }],
      aggregates: {
        ...state.aggregates,
        [userId]: newAggregate,
      },
    });
    
    // Emit event (could trigger query side updates)
    return axon.userCreated.createSignal(newAggregate);
  },
});

// Query side: Read operations
const getUserQuery = collateral<{ id: string }>('getUserQuery');
const userQueryHandler = ctxBuilder.neuron('userQueryHandler', {}).dendrite({
  collateral: getUserQuery,
  response: async (payload, axon, ctx) => {
    // Read from aggregate (in real CQRS, this would come from a read model)
    const state = ctx.get();
    const aggregate = state?.aggregates[payload.id];
    
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

### CQRS Benefits with CNStra

- **Clear separation**: Commands and queries are naturally separated through different collaterals and neurons
- **State management**: Context provides a natural place for aggregates and read models
- **Event sourcing potential**: Each command can emit events that update read models
- **Scalability**: Command and query sides can be scaled independently
- **Type safety**: Full type safety for both commands and queries

### Advanced CQRS Patterns

CNStra can support more advanced CQRS patterns:

- **Event sourcing**: Store all commands as events and rebuild aggregates from events
- **Read model projections**: Use neurons to project events into read models
- **Saga orchestration**: Coordinate multiple aggregates through CNStra workflows
- **Eventual consistency**: Handle eventual consistency between command and query sides

## Best Practices

1. **Development**: Use context to preserve all intermediate state during development
2. **Checkpointing**: Save checkpoints on errors or at milestones, not on every response
3. **CQRS**: Separate command and query collaterals and neurons for clear boundaries
4. **State persistence**: Combine CNStra with external storage (Redis, database) for production persistence
5. **Performance**: Consider the cost of checkpointing - save state strategically, not excessively

## See Also

- [BullMQ Integration](/docs/integrations/bullmq) - See checkpointing in action with BullMQ
- [Backend Overview](/docs/backend/overview) - General backend orchestration patterns

