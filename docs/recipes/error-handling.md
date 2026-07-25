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

Errors are delivered immediately via `onResponse`, and they also **fail the run**: `stimulation.waitUntilComplete()` rejects if **any dendrite `response` throws or returns a rejected Promise** (a *failed task*) — or if any response listener (local or global) throws or rejects. A dendrite throw fails the run on its own; you do **not** need a listener for `waitUntilComplete()` to reject.

```ts
const stimulation = cns.stimulate(signal, {
  onResponse: async (response) => {
    if (response.error) {
      await errorsRepo.store({
        signal:
          response.outputSignal?.collateral || response.inputSignal?.collateral,
        error: String(response.error),
      });
      
      if (response.error instanceof ValidationError) {
        handleValidationError(response.error);
      }
    }
  }
});
await stimulation.waitUntilComplete();
```

## Fire-and-forget & the lazy completion promise

`cns.stimulate(...)` returns a **`CNSStimulation` object, not a Promise**. The completion Promise is materialized **lazily** — only when you call `stimulation.waitUntilComplete()`. This is a deliberate optimization (allocating a Promise per stimulation is the single most expensive setup cost), but it has a sharp edge:

> ⚠️ **If you fire-and-forget a stimulation (never call `waitUntilComplete()`) and register no response listener, a thrown dendrite error is completely swallowed.** It is caught internally and recorded on `response.error`, but with nothing observing it there is no log, no throw, and **not even an unhandled promise rejection** — the rejecting Promise was never created. (With no listener, the run also skips building the response object entirely, so the error has nowhere to surface.)

```ts
// ❌ Silent on failure: no listener AND not awaited.
cns.stimulate(signal); // a throwing dendrite here vanishes without a trace
```

Make failures visible with **either** of these — pick based on the call site:

```ts
// A) Global listener — cheapest for fire-and-forget producers (WS streams, queues,
//    background ingestion). One listener surfaces errors from every stimulation,
//    so you never have to await individual runs.
cns.addResponseListener(r => {
  if (r.error) console.error('[cns] neuron error:', r.error);
});
cns.stimulate(signal); // a failure is now logged

// B) Await completion — when the caller owns the run and wants the rejection.
//    Works even with NO onResponse listener: a dendrite throw becomes a failed
//    task, and waitUntilComplete() rejects with
//    "Stimulation completed with N failed task(s)".
await cns.stimulate(signal).waitUntilComplete();
```

Rule of thumb: **await `waitUntilComplete()`** when a caller drives a single run and cares about its outcome; register a **global `addResponseListener`** for long-lived, fire-and-forget producers where awaiting each run is impractical. Do at least one — otherwise dendrite failures are invisible.

## Error recovery with context

Save context for retry on failure:

```ts
let savedContext: ICNSStimulationContextStore | undefined;

const stimulation = cns.stimulate(signal, {
  onResponse: (response) => {
    if (response.error) {
      savedContext = response.stimulation.getContext(); // save for retry
    }
  }
});
await stimulation.waitUntilComplete();

// Retry with preserved context
if (savedContext) {
  const retryStimulation = cns.stimulate(retrySignal, { ctx: savedContext });
  await retryStimulation.waitUntilComplete();
}
```

## Retry with backoff (self-loop)

Use a self-looping neuron with context to track **per-neuron per-stimulation retry attempts** (metadata), while business data flows through payloads:

```ts
import { withCtx, collateral } from '@cnstra/core';

const tryTask = collateral<{ taskId: string }>();
const completed = collateral<{ taskId: string }>();
const failed = collateral<{ taskId: string; reason: string }>();

const taskRunner = withCtx<{ attempt: number }>()
  .neuron({ tryTask, completed, failed })
  .dendrite({
    collateral: tryTask,
    response: async (payload, axon, ctx) => {
      // Context stores per-neuron per-stimulation metadata (retry attempts)
      const prev = ctx.get() ?? { attempt: 0 };
      const attempt = prev.attempt + 1;
      ctx.set({ attempt });

      try {
        // Business data (taskId) comes from payload
        await performTask(payload.taskId);
        return axon.completed.createSignal({ taskId: payload.taskId });
      } catch (err) {
        if (attempt < 5) {
          const backoff = Math.pow(2, attempt) * 100; // exponential backoff
          await new Promise(resolve => setTimeout(resolve, backoff));
          // Business data flows through payload, not context
          return axon.tryTask.createSignal(payload); // self-loop retry
        }
        return axon.failed.createSignal({ taskId: payload.taskId, reason: String(err) });
      }
    },
  });
```

**Key point**: Context stores **per-neuron per-stimulation metadata** (attempt count), while **business data** (taskId) flows through signal payloads.

## Tips

- Use `onResponse` for real-time error logging/monitoring; make it `async` if you need to persist.
- Store minimal retry state in context (attempt count, correlation IDs).
- For long-lived sagas, persist context to a DB/OIMDB and re-stimulate on external triggers.
- Always set a max retry limit to avoid infinite loops.

### Global listeners

Global listeners registered via `addResponseListener` run for every stimulation alongside the local `onResponse`. They also can be async; failures in any listener reject the `stimulation.waitUntilComplete()` Promise.

## Best practices

- Timeouts: wrap external I/O in timeouts inside dendrites and async `onResponse` to avoid hanging runs.
- Idempotency: design `onResponse` persistence to be idempotent (e.g., upserts, unique keys) so retries are safe.
- Retry policy: prefer bounded retries with exponential backoff; use context to track attempts; avoid hot loops.
- Partial failure: emit explicit failure signals from dendrites when business errors occur; reserve thrown errors for exceptional cases.
- Observability: tag your own run/correlation id (if you have one) and collaterals in logs/metrics; capture `queueLength` to identify bottlenecks (and split it into `pendingActivations` / `activeActivations` to tell "producing too fast" from "slow bodies" apart).
- Isolation: keep `onResponse` lightweight; move heavy processing to dedicated neurons/signals when possible.
- Concurrency: if persisting from `onResponse`, consider batching or a queue to smooth spikes in traffic.
- Ordering: if ordering matters, include sequence numbers in payloads or serialize writes per run/correlation id you provide.
- Durability: when persisting context for retries, write before emitting downstream effects; verify on restart.

