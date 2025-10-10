---
id: error-handling
title: Error Handling & Retry Logic - Best Practices for State Machines
sidebar_label: Error Handling
slug: /recipes/error-handling
description: Learn error handling and retry strategies for CNStra state machines. Implement exponential backoff, circuit breakers, error recovery with context, and monitoring for resilient orchestration.
keywords: [error handling, retry logic, exponential backoff, circuit breaker, error recovery, fault tolerance, resilience patterns, retry strategies, failure handling, exception handling, error monitoring, graceful degradation, compensation, rollback, idempotency]
---

Handle errors gracefully using `onResponse` callbacks (sync or async) and context-based retry.

## Error delivery

Errors are delivered immediately via `onResponse` and also cause `stimulate(...)` to reject if any response listener (local or global) throws or rejects:

```ts
await cns.stimulate(signal, {
  onResponse: async (response) => {
    if (response.error) {
      await errorsRepo.store({
        id: response.stimulationId,
        signal: response.outputSignal?.collateralName || response.inputSignal?.collateralName,
        error: String(response.error),
      });
      
      if (response.error instanceof ValidationError) {
        handleValidationError(response.error);
      }
    }
  }
});
```

If you do not await `stimulate(...)`, the run still proceeds, but rejections from listeners won’t be observed by the caller.

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

- Use `onResponse` for real-time error logging/monitoring; make it `async` if you need to persist.
- Store minimal retry state in context (attempt count, correlation IDs).
- For long-lived sagas, persist context to a DB/OIMDB and re-stimulate on external triggers.
- Always set a max retry limit to avoid infinite loops.

### Global listeners

Global listeners registered via `addResponseListener` run for every stimulation alongside the local `onResponse`. They also can be async; failures in any listener reject the `stimulate(...)` Promise.

## Best practices

- Timeouts: wrap external I/O in timeouts inside dendrites and async `onResponse` to avoid hanging runs.
- Idempotency: design `onResponse` persistence to be idempotent (e.g., upserts, unique keys) so retries are safe.
- Retry policy: prefer bounded retries with exponential backoff; use context to track attempts; avoid hot loops.
- Partial failure: emit explicit failure signals from dendrites when business errors occur; reserve thrown errors for exceptional cases.
- Observability: tag `stimulationId` and collateral names in logs/metrics; capture queueLength to identify bottlenecks.
- Isolation: keep `onResponse` lightweight; move heavy processing to dedicated neurons/signals when possible.
- Concurrency: if persisting from `onResponse`, consider batching or a queue to smooth spikes in traffic.
- Ordering: if ordering matters, include sequence numbers in payloads or serialize writes per `stimulationId`.
- Durability: when persisting context for retries, write before emitting downstream effects; verify on restart.

