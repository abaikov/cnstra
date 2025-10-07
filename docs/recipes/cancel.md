---
id: cancel
title: Cancellation
sidebar_label: Cancellation
slug: /recipes/cancel
---

Use `AbortSignal` to cancel in-flight stimulation runs.

```ts
const controller = new AbortController();

cns.stimulate(collateral.createSignal(input), {
  abortSignal: controller.signal,
});

// Later
controller.abort();
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
cns.stimulate(start.createSignal(payload), { abortSignal: ac.signal });

// cancel at any time (e.g., on route change)
ac.abort();
```
