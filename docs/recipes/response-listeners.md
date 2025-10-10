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
      console.log('IN', r.inputSignal.collateralName);
    }
    if (r.outputSignal) {
      console.log('OUT', r.outputSignal.collateralName);
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
    tracer.add('emit', r.outputSignal.collateralName);
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

## Tips
- Keep listeners lightweight; heavy work should be offloaded (e.g., buffer and batch).
- Exceptions thrown in listeners are swallowed to avoid breaking the run.
- Combine with `allowName`/`maxNeuronHops` in `stimulate` options to constrain traversal during debugging.
