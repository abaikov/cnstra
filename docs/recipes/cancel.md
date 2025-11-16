---
id: cancel
title: Cancellation
sidebar_label: Cancellation
slug: /recipes/cancel
---

Use `AbortSignal` to cancel in-flight stimulation runs.

```ts
const controller = new AbortController();

const stimulation = cns.stimulate(collateral.createSignal(input), {
  abortSignal: controller.signal,
});

// Later
controller.abort();
await stimulation.waitUntilComplete();
```

Notes:
- Dendrites receive `abortSignal` in their context; long operations should check it.
- The same `abortSignal` is visible to every neuron participating in the current run; each can react early.
- Compose with UI events (route change, user typing) to avoid stale work.

Example: cooperative cancel inside a neuron

```ts
const work = neuron('work', {}).dendrite({
  collateral: someInput,
  response: async (payload, axon, ctx) => {
    if (ctx.abortSignal?.aborted) return; // bail before starting
    const res = await heavyTask(payload, ctx.abortSignal); // pass signal to IO when possible
    if (ctx.abortSignal?.aborted) return; // bail before emit
    return undefined;
  },
});
```

Cancelling a running stimulation

```ts
const ac = new AbortController();

// start the run
const stimulation = cns.stimulate(start.createSignal(payload), { abortSignal: ac.signal });

// cancel at any time (e.g., on route change)
ac.abort();
await stimulation.waitUntilComplete();
```

## Graceful shutdown

There are two ways to finish active runs:

- Natural drain (recommended):
  - Stop starting new `stimulate(...)` calls and simply `await` all in‑flight stimulations via `stimulation.waitUntilComplete()`.
  - The internal queue drains and the run completes naturally.

- Cooperative termination via `AbortSignal`:
  - Pass an `abortSignal` to `stimulate(...)` and call `abort()` when you want to stop.
  - Behavior:
    - New queued items do not start (cancel gate).
    - Once active tasks finish, the run resolves even if there are queued items that never started.
  - Implications:
    - Not‑started items are skipped; if you need them later, persist them (e.g., in your context store or an external queue) and restart explicitly.

Example: graceful shutdown on process signals

```ts
const ac = new AbortController();
process.on('SIGTERM', () => ac.abort());
process.on('SIGINT', () => ac.abort());

// elsewhere
const stimulation = cns.stimulate(start.createSignal(payload), { abortSignal: ac.signal });
await stimulation.waitUntilComplete();
```
