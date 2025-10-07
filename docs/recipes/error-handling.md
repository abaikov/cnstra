---
id: error-handling
title: Error Handling & Retry Logic - Best Practices for State Machines
sidebar_label: Error Handling
slug: /recipes/error-handling
description: Learn error handling and retry strategies for CNStra state machines. Implement exponential backoff, circuit breakers, error recovery with context, and monitoring for resilient orchestration.
keywords: [error handling, retry logic, exponential backoff, circuit breaker, error recovery, fault tolerance, resilience patterns, retry strategies, failure handling, exception handling, error monitoring, graceful degradation, compensation, rollback, idempotency]
---

Handle errors gracefully using `onResponse` callbacks and context-based retry.

## Error delivery

Errors are delivered immediately via `onResponse`:

```ts
await cns.stimulate(signal, {
  onResponse: (response) => {
    if (response.error) {
      console.error(`Error in neuron processing:`, response.error);
      console.error(`Signal: ${response.outputSignal?.collateral.id}`);
      console.error(`Stimulation: ${response.stimulationId}`);
      
      if (response.error instanceof ValidationError) {
        handleValidationError(response.error);
      }
    }
  }
});
```

## Error recovery with context

Save context for retry on failure:

```ts
let savedContext: ICNSStimulationContextStore | undefined;

await cns.stimulate(signal, {
  onResponse: (response) => {
    if (response.error) {
      savedContext = response.contextStore; // save for retry
    }
  }
});

// Retry with preserved context
if (savedContext) {
  await cns.stimulate(retrySignal, { ctx: savedContext });
}
```

## Retry with backoff (self-loop)

Use a self-looping neuron with context to track attempts and implement exponential backoff:

```ts
import { withCtx, collateral } from '@cnstra/core';

const tryTask = collateral<{ taskId: string }>('task:try');
const completed = collateral<{ taskId: string }>('task:completed');
const failed = collateral<{ taskId: string; reason: string }>('task:failed');

const taskRunner = withCtx<{ attempt: number }>()
  .neuron('task-runner', { tryTask, completed, failed })
  .dendrite({
    collateral: tryTask,
    response: async (payload, axon, ctx) => {
      const prev = ctx.get() ?? { attempt: 0 };
      const attempt = prev.attempt + 1;
      ctx.set({ attempt });

      try {
        await performTask(payload.taskId);
        return axon.completed.createSignal({ taskId: payload.taskId });
      } catch (err) {
        if (attempt < 5) {
          const backoff = Math.pow(2, attempt) * 100; // exponential backoff
          await new Promise(resolve => setTimeout(resolve, backoff));
          return axon.tryTask.createSignal(payload); // self-loop retry
        }
        return axon.failed.createSignal({ taskId: payload.taskId, reason: String(err) });
      }
    },
  });
```

## Tips

- Use `onResponse` for real-time error logging and monitoring.
- Store minimal retry state in context (attempt count, correlation IDs).
- For long-lived sagas, persist context to a DB/OIMDB and re-stimulate on external triggers.
- Always set a max retry limit to avoid infinite loops.

