---
id: api
title: CNStra API Reference - Neurons, Signals, Collaterals, Context
sidebar_label: API
slug: /core/api
description: Complete CNStra API reference. Learn neuron, collateral, signal, dendrite, axon, context, stimulation APIs. Type-safe orchestration primitives for JavaScript/TypeScript state machines.
keywords: [API reference, API documentation, neuron API, signal API, collateral API, dendrite API, axon API, context API, stimulation API, TypeScript API, type-safe API, function reference, method reference, interface reference]
---

### `collateral<T>()`
Create a typed output channel.

```ts
const userEvent = collateral<{ userId: string }>();
const simpleEvent = collateral();
```

### `collateral.createSignal(payload?)`
Create a signal from a collateral. Payload is optional for collaterals without payload type.

```ts
const signal = userEvent.createSignal({ userId: '123' });
const emptySignal = simpleEvent.createSignal(); // no payload
```

### `neuron(axon: Axon)`
Create a neuron with the given axon (neuron identity is the object itself).

```ts
const myNeuron = neuron({ output: myCollateral });
```

### Signal ownership

::::warning Signal ownership
Recommended: a neuron should emit only collaterals declared in its own axon. Cross-neuron orchestration is typically done by having a controller own request collaterals and letting each domain neuron emit its own responses.
::::

Incorrect (emits someone else's collateral):

```ts
// DON'T: myNeuron emits otherAxon.some
return otherAxon.some.createSignal(result);
```

Correct (controller-owned request, domain emits its own):

```ts
const controller = neuron({ requestA });
const serviceA = neuron({ doneA })
  .dendrite({ collateral: requestA, response: (_, axon) => axon.doneA.createSignal(...) });
// controller emits requestA; serviceA emits doneA
```

### `neuron.dendrite({...})`
Add a dendrite bound to a collateral.

```ts
myNeuron.dendrite({
  collateral: inputCollateral,
  response: async (payload, axon, ctx) => {
    // ctx: per-neuron per-stimulation context (metadata storage)
    if (ctx.abortSignal?.aborted) return;
    // Business data flows through payloads, not context
    return axon.output.createSignal(result);
  }
});
```

### `neuron.bind(axon, map)`
Exhaustive bind to every collateral of another neuron's axon (compile-time safety).

```ts
// Context is for per-neuron per-stimulation metadata, not business data
withCtx<{ attempt: number }>().neuron({})
  .bind(order, {
    created: (payload, axon, ctx) => { 
      // Context stores per-neuron per-stimulation metadata
      const attempt = (ctx.get()?.attempt || 0) + 1;
      ctx.set({ attempt });
      // Business data flows through payloads
    },
    updated: (payload) => { /* ... */ },
    cancelled: (payload) => { /* ... */ },
  });
```

### `neuron.setConcurrency(n: number | undefined)`
Set per-neuron global concurrency limit (shared across all parallel stimulations).

```ts
const worker = neuron({ out })
  .setConcurrency(2) // max 2 parallel executions across all runs
  .dendrite({ collateral: task, response: async (p, axon) => { /* ... */ } });
```

This limits how many concurrent executions of this neuron's dendrites can run at the same time, even across different `stimulate()` calls. Useful for rate-limiting external APIs or heavy I/O operations.

### `neuron.setMaxDuration(ms: number | undefined)`
Set maximum execution duration for this neuron's dendrites. If exceeded, the dendrite execution will be aborted.

```ts
const worker = neuron({ out })
  .setMaxDuration(5000) // 5 seconds max
  .dendrite({ collateral: task, response: async (p, axon) => { /* ... */ } });
```

### `CNS`
Main orchestrator. `new CNS(neurons, options?)`

**Constructor options:**
```ts
const cns = new CNS(neurons, {
  autoCleanupContexts: false // Auto-cleanup unused contexts (builds SCC analysis lazily on first use; adds per-hop runtime cost — see performance docs)
});
```

**Properties:**
- `cns.network` — Access to network graph analysis (SCC, subscribers, etc.)

```ts
const unsubscribe = cns.addResponseListener(r => { /* ... */ });
```

### `cns.stimulate(signal, options?)`
Run a stimulation. Returns a `CNSStimulation` instance. Use `stimulation.waitUntilComplete()` to await completion.

```ts
const stimulation = cns.stimulate(userCreated.createSignal({ id: '123', name: 'John' }));
await stimulation.waitUntilComplete();
```

### `cns.activate(tasks, options?)`
Start a stimulation with activation tasks directly. Useful for advanced scenarios where you need fine-grained control over task execution.

```ts
const tasks: TCNSNeuronActivationTask[] = [
  { neuron: worker, dendriteCollateral: task, input: signal }
];
const stimulation = cns.activate(tasks, { concurrency: 4 });
await stimulation.waitUntilComplete();
```

#### Single entry point
`stimulate(...)` and `activate(...)` are the entry points that begin execution. Nothing runs until you explicitly stimulate a signal or activate tasks. This is the "inverted" part of CNS: you start the run and each dendrite returns the explicit continuation.

#### Stimulation options
```ts
const stimulation = cns.stimulate(signal, {
  onResponse: (r) => { /* per-stimulation hook */ },
  abortSignal,                 // Abort the whole run cooperatively
  concurrency: 4,              // Per-stimulation parallelism
  maxNeuronHops:  undefined,   // Disabled by default; set to cap traversal length
  ctx,                         // Optional: reuse an existing context store (in‑process)
  modality,                    // Optional: modality selection for modalityDendrite
  afferentPath,                // Optional: afferent path selection for modalityDendrite
});
await stimulation.waitUntilComplete();
```

#### Response shape (for listeners)
Both `onResponse` and global listeners receive the same object:

```ts
{
  inputSignal?: TCNSSignal;    // when a signal is ingested
  outputSignal?: TCNSSignal;   // when a dendrite returns a continuation
  contextValue: Map<object, unknown>; // per-neuron per-stimulation metadata (not business data)
  queueLength: number;         // all activations still owned = pending + active
  pendingActivations: number;  // body not invoked yet
  activeActivations: number;   // body invoked, awaiting an unsettled promise
  stimulation: CNSStimulation; // reference to the stimulation instance
  error?: Error;               // when a dendrite throws
  hops?: number;               // present if maxNeuronHops is set
}
```

##### The counters

The unit is an **activation** — one `(neuron, dendrite, signal)` triple. A signal
produces one activation per subscriber of its collateral.

An activation is *pending* until its dendrite body is invoked, then *active*
until the promise that body returned settles. A synchronous body passes through
`active` within a single scheduler iteration and is decremented before its
response is emitted, so only genuinely asynchronous work is ever observed there.
Subscribers held behind an async `onResponse` count as **pending**, not active —
the split is by lifecycle stage, not by "something is being awaited".

`queueLength` counts active work deliberately, the way an AMQP queue counts
unacknowledged messages in its total; `getAllActivationTasks()` follows the same
model. So:

```ts
r.queueLength === 0            // the stimulation is finished
```

This is the exact condition used internally to settle `waitUntilComplete()`, so
it holds on the terminal response and nowhere else.

:::caution `queueLength === 0` is not a batch boundary
A response is emitted when an activation *finishes* — but a synchronous batch
just as often ends when one *starts* and returns a promise, and no response is
emitted at that moment. To flush or commit at batch boundaries use
[`onDrain`](#batch-boundaries-ondrain).
:::

### Global response listeners (middleware‑style)
Use `addResponseListener` to attach cross‑cutting concerns (logging, metrics, tracing) that run for every stimulation.

```ts
const off = cns.addResponseListener((r) => {
  if (r.error) {
    metrics.count('error', 1);
    return;
  }
  if (r.outputSignal) {
    trace.log('out', r.outputSignal.collateral);
  } else if (r.inputSignal) {
    trace.log('in', r.inputSignal.collateral);
  }
});

// later
off();
```

### Batch boundaries: `onDrain`

A CNStra run is a sequence of **synchronous turns**. A turn starts when something
feeds the scheduler — the initial `stimulate()`, a settled neuron body, a settled
async listener — and ends when nothing more can run without yielding to the event
loop. `onDrain` fires once at the end of every turn.

```ts
cns.stimulate(signal, {
  onDrain: () => store.flush(),                       // batch boundary
  onResponse: r => { if (r.queueLength === 0) done(); } // stimulation finished
});
```

Or once for the whole organism, which is how integrations install themselves:

```ts
const off = cns.addDrainListener(() => store.flush());
```

#### Why this cannot be a response

A turn can end in six ways, and a response is emitted in only the first:

1. an activation finished and left the queue empty
2. the last activation **started** and returned a promise
3. the stimulation-level `concurrency` limit was reached
4. the stimulation was aborted
5. subscribers are parked behind an async `onResponse`
6. a per-neuron `setConcurrency` gate forced an activation onto a promise

Case 2 is the common one. In `A → async B → C`, the turn ends the moment `B`'s
body reaches its first `await` — anything `B` wrote synchronously before that
point is already in the store, but no response has been emitted since `B` was
scheduled. Without `onDrain` those writes stay uncommitted until `B` settles,
which is exactly how optimistic updates and loading states get lost.

#### Payload

```ts
{
  stimulation: CNSStimulation;
  queueLength: number;         // pending + active; zero means finished
  pendingActivations: number;  // non-zero here means BLOCKED
  activeActivations: number;   // non-zero means another drain is coming
}
```

Same counters as on a response, but measured *after* the loop exhausted rather
than before the work runs. On a response `pendingActivations` is a forecast; on a
drain it is a fact — a non-zero value can only mean blocked by a concurrency
limit or by an abort, never "about to run".

#### Notes

- Returns `void`; a returned promise is **not** awaited. There is nothing to gate
  on — the next turn is started by someone else's promise settling. For async work
  at a boundary use `onResponse`, which does support promises.
- A listener that throws is logged and isolated; it cannot derail the stimulation
  or the other listeners.
- Re-entrancy is safe. A nested `stimulate()` from inside the callback is a
  separate stimulation and announces its own boundary inline. Feeding work back
  into the *same* stimulation via `enqueueTasks()` runs it, but folds it into the
  turn already closing, so it yields no additional boundary.
- Abort ends a turn without any further response or drain progress; pair it with
  `waitUntilComplete().catch(...)` if you need a final commit on that path.

### `CNSStimulation` methods

#### `stimulation.waitUntilComplete()`
Wait for the stimulation to complete. Returns a Promise that resolves when all tasks are done or rejects on error.

```ts
await stimulation.waitUntilComplete();
```

#### `stimulation.getContext()`
Get the context store for this stimulation. Useful for saving/restoring stimulation state.

```ts
const ctx = stimulation.getContext();
// Save for retry
const savedCtx = ctx;
```

#### `stimulation.getFailedTasks()`
Get all tasks that failed or were aborted.

```ts
const failures = stimulation.getFailedTasks();
failures.forEach(f => console.error(f.error));
```

### `cns.network` — Network Graph Analysis

Access network analysis utilities:

```ts
// Get subscribers for a collateral
const subscribers = cns.network.getSubscribers(userEvent);

// Get all collaterals
const collaterals = cns.network.getCollaterals();

// Get strongly connected components
const sccs = cns.network.stronglyConnectedComponents;
```

Notes
- Local `onResponse` (per stimulation) runs as well as global listeners; both can be `async`.
- All listeners run in parallel per response; errors from any listener reject the `stimulation.waitUntilComplete()` Promise.
- If all listeners are synchronous, no extra async deferrals are introduced.
- Use `maxNeuronHops` to constrain traversal if needed.
