---
id: response-listeners
title: "Response Listeners: Logging, Metrics, and Tracing"
sidebar_label: Response listeners
description: Learn how to observe every step of a stimulation using per-run onResponse and global addResponseListener for logging, metrics, and tracing.
keywords: [middleware, logging, metrics, tracing, onResponse, addResponseListener, hooks, interceptors]
---

CNStra lets you observe traversal without polluting domain neurons. There are two hook points:

- Per‑run: `onResponse` option of `cns.stimulate(...)`
- Global: `cns.addResponseListener(...)`

Both receive the same response object with `inputSignal`, `outputSignal`, `error`, `ctx`, and `queueLength`.

## Per‑run `onResponse`
Use for ad‑hoc debugging or request‑scoped tracing.

```ts
await cns.stimulate(start.createSignal({ id: '123' }), {
  onResponse: (r) => {
    if (r.error) {
      console.error('[run]', r.error.message);
      return;
    }
    if (r.inputSignal) {
      console.log('IN', r.inputSignal.collateral);
    }
    if (r.outputSignal) {
      console.log('OUT', r.outputSignal.collateral);
    }
  },
});
```

## Global `addResponseListener`
Use for cross‑cutting concerns: metrics, logging, or OpenTelemetry spans.

```ts
const off = cns.addResponseListener((r) => {
  if (r.error) {
    metrics.increment('cnstra.error');
    return;
  }
  if (r.outputSignal) {
    tracer.add('emit', r.outputSignal.collateral);
  }
});

// later, to remove the listener
off();
```

## What events are delivered?
- `inputSignal`: when a signal enters the run (including the initial one)
- `outputSignal`: when a dendrite returns a continuation
- `error`: when a dendrite throws
- `queueLength`: current internal work queue length (can be used for backpressure metrics)

## Async listeners are a barrier (this is how checkpointing works)

A listener may be synchronous or `async`. The return value changes the semantics:

- **Return nothing (or a non-promise)** → purely observational. Traversal continues immediately; the listener does not affect flow.
- **Return a promise (or use `async`/`await`)** → the listener becomes a **barrier**: the subscribers of the current response (the *next* hops) are **not enqueued until your promise resolves**.

This blocking is intentional and is what makes **per-hop checkpointing** correct: in `onResponse` you can durably persist progress *before* the next hop runs, so a crash between the checkpoint and the next hop resumes exactly the not-yet-done work — no double execution, no lost work. Any neuron's response can act as a checkpoint point this way.

```ts
await cns.stimulate(start.createSignal(input), {
  onResponse: async (r) => {
    // Subscribers of r.outputSignal wait until this write lands.
    await db.checkpoints.save(serialize(r.stimulation));
  },
});
```

> ⚠️ **Footgun**: because the same hook is used for observation *and* gating, a "passive" listener that happens to `await` something (a slow logger, a metrics flush) will **throttle the entire graph** — every hop now waits on it. For pure observation, do not return/await anything; buffer and flush out of band instead.

## Tips
- Keep listeners lightweight; heavy work should be offloaded (e.g., buffer and batch) — unless you *intend* to gate (see above).
- Exceptions thrown in listeners will reject `stimulation.waitUntilComplete()` once all active tasks finish.
- Combine with `maxNeuronHops` in `stimulate` options to constrain traversal during debugging. `maxNeuronHops` is disabled by default.
