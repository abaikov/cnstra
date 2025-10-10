---
id: api
title: CNStra API Reference - Neurons, Signals, Collaterals, Context
sidebar_label: API
slug: /core/api
description: Complete CNStra API reference. Learn neuron, collateral, signal, dendrite, axon, context, stimulation APIs. Type-safe orchestration primitives for JavaScript/TypeScript state machines.
keywords: [API reference, API documentation, neuron API, signal API, collateral API, dendrite API, axon API, context API, stimulation API, TypeScript API, type-safe API, function reference, method reference, interface reference]
---

### `collateral<T>(id: string)`
Create a typed output channel.

```ts
const userEvent = collateral<{ userId: string }>('user:event');
const simpleEvent = collateral('simple:event');
```

### `neuron(id: string, axon: Axon)`
Create a neuron with the given axon.

```ts
const myNeuron = neuron('my-neuron', { output: myCollateral });
```

### Signal ownership

::::warning Signal ownership
A neuron may emit only collaterals declared in its own axon. It must not emit another neuron's collaterals. Cross-neuron orchestration is done by having a controller own request collaterals and letting each domain neuron emit its own responses.
::::

Incorrect (emits someone else's collateral):

```ts
// DON'T: myNeuron emits otherAxon.some
return otherAxon.some.createSignal(result);
```

Correct (controller-owned request, domain emits its own):

```ts
const controller = neuron('controller', { requestA });
const serviceA = neuron('serviceA', { doneA })
  .dendrite({ collateral: requestA, response: (_, axon) => axon.doneA.createSignal(...) });
// controller emits requestA; serviceA emits doneA
```

### `neuron.dendrite({...})`
Add a dendrite bound to a collateral.

```ts
myNeuron.dendrite({
  collateral: inputCollateral,
  response: async (payload, axon, ctx) => {
    if (ctx.abortSignal?.aborted) return;
    return axon.output.createSignal(result);
  }
});
```

### `neuron.bind(axon, map)`
Exhaustive bind to every collateral of another neuron's axon (compile-time safety).

```ts
withCtx().neuron('order-mailer', {})
  .bind(order, {
    created: (payload) => { /* ... */ },
    updated: (payload) => { /* ... */ },
    cancelled: (payload) => { /* ... */ },
  });
```

### `neuron.setConcurrency(n: number | undefined)`
Set per-neuron global concurrency limit (shared across all parallel stimulations).

```ts
const worker = neuron('worker', { out })
  .setConcurrency(2) // max 2 parallel executions across all runs
  .dendrite({ collateral: task, response: async (p, axon) => { /* ... */ } });
```

This limits how many concurrent executions of this neuron's dendrites can run at the same time, even across different `stimulate()` calls. Useful for rate-limiting external APIs or heavy I/O operations.

### `CNS`
Main orchestrator. `new CNS(neurons, options?)`

```ts
const unsubscribe = cns.addResponseListener(r => { /* ... */ });
```

### `cns.stimulate(signal, options?)`
Run a stimulation.

```ts
await cns.stimulate(userCreated.createSignal({ id: '123', name: 'John' }));
```

#### Single entry point
`stimulate(...)` is the only entry point that begins execution. Nothing runs until you explicitly stimulate a signal. This is the “inverted” part of IERG: you start the run and each dendrite returns the explicit continuation.

#### Stimulation options
```ts
await cns.stimulate(signal, {
  onResponse: (r) => { /* per-stimulation hook */ },
  abortSignal,                 // Abort the whole run cooperatively
  concurrency: 4,              // Per-stimulation parallelism
  maxNeuronHops: 256,          // Safety cap for traversal length
  allowName: (neuronName) => true, // Filter allowed neurons by name
  stimulationId: 'run-123',    // Optional id for tracing
  ctx,                         // Pre-supplied context store
  createContextStore: () => myStore(), // Custom context store factory
});
```

#### Response shape (for listeners)
Both `onResponse` and global listeners receive the same object:

```ts
{
  inputSignal?: TCNSSignal;    // when a signal is ingested
  outputSignal?: TCNSSignal;   // when a dendrite returns a continuation
  ctx: ICNSStimulationContextStore;
  queueLength: number;         // current work queue size
  error?: Error;               // when a dendrite throws
  hops?: number;               // present if maxNeuronHops is set
}
```

### Global response listeners (middleware‑style)
Use `addResponseListener` to attach cross‑cutting concerns (logging, metrics, tracing) that run for every stimulation.

```ts
const off = cns.addResponseListener((r) => {
  if (r.error) {
    metrics.count('error', 1);
    return;
  }
  if (r.outputSignal) {
    trace.log('out', r.outputSignal.collateralName);
  } else if (r.inputSignal) {
    trace.log('in', r.inputSignal.collateralName);
  }
});

// later
off();
```

Notes
- Local `onResponse` (per stimulation) runs as well as global listeners; both can be `async`.
- All listeners run in parallel per response; errors from any listener reject the `stimulate(...)` Promise.
- If all listeners are synchronous, no extra async deferrals are introduced.
- Use `allowName`/`maxNeuronHops` to constrain traversal if needed.
