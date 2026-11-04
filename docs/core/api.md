---
id: api
title: CNStra API Reference - Neurons, Signals, Collaterals, Context
sidebar_label: API
slug: /core/api
description: Complete CNStra API reference. Learn neuron, collateral, signal, dendrite, axon, context, stimulation APIs. Type-safe orchestration primitives for JavaScript/TypeScript state machines.
keywords: [API reference, API documentation, neuron API, signal API, collateral API, dendrite API, axon API, context API, stimulation API, TypeScript API, type-safe API, function reference, method reference, interface reference]
---

```ts setup
import { CNS, collateral, neuron, neuronFactory, createCNS } from '@cnstra/core';
import type {
  ICNSCollateral,
  TCNSAfferentPath,
  TCNSModality,
  TCNSNeuron,
  TCNSNeuronActivationTask,
  TCNSSignal,
  TCNSStimulationResponse,
} from '@cnstra/types';

declare const cns: CNS<TCNSNeuron<any>>;
declare const myCollateral: ICNSCollateral<{ id: string }>;
declare const inputCollateral: ICNSCollateral<{ id: string }>;
declare const otherAxon: { some: ICNSCollateral<{ id: string }> };
declare const requestA: ICNSCollateral<{ id: string }>;
declare const doneA: ICNSCollateral<{ id: string }>;
declare const order: {
  created: ICNSCollateral<{ orderId: string }>;
  updated: ICNSCollateral<{ orderId: string }>;
  cancelled: ICNSCollateral<{ orderId: string }>;
};
declare const out: ICNSCollateral<{ id: string }>;
declare const task: ICNSCollateral<{ id: string }>;
declare const worker: TCNSNeuron;
declare const signal: TCNSSignal<ICNSCollateral<{ id: string }>>;
declare const userCreated: ICNSCollateral<{ id: string; name: string }>;
declare const abortSignal: AbortSignal;
declare const modality: TCNSModality;
declare const afferentPath: TCNSAfferentPath;
declare const r: TCNSStimulationResponse;
declare const metrics: { count(name: string, value: number): void };
declare const trace: { log(direction: string, collateral: ICNSCollateral<unknown>): void };
declare const store: { flush(): void };
declare function done(): void;
type TApp = { id: string; name: string };
type TDb = { apps: { upsertEntityByKey(key: string, app: TApp): unknown } };
declare const dbA: TDb;
declare const dbB: TDb;
```

### `collateral<T>()`
Create a typed output channel.

```ts
const userEvent = collateral<{ userId: string }>();
const simpleEvent = collateral();
```

### `collateral.createSignal(payload?)`
Create a signal from a collateral. Payload is optional for collaterals without payload type.

```ts
const userEvent = collateral<{ userId: string }>();
const simpleEvent = collateral();

const userSignal = userEvent.createSignal({ userId: '123' });
const emptySignal = simpleEvent.createSignal(); // no payload
```

### `neuron(axon)`
Create a neuron with the given axon (neuron identity is the object itself).

```ts
const myNeuron = neuron({ output: myCollateral });
```

### Signal ownership

::::warning Signal ownership
A collateral belongs to exactly one neuron's axon: `new CNS` throws when two neurons hold the same collateral, so every collateral has one owner. A listener that joins several sources declares one dendrite per source. Emitting a collateral from another neuron's axon is not checked at runtime, so keep to your own: cross-neuron orchestration is done by having a controller own request collaterals and letting each domain neuron emit its own responses.
::::

Incorrect (emits someone else's collateral):

```ts
// DON'T: myNeuron emits otherAxon.some
const myNeuron = neuron({ output: myCollateral }).dendrite({
  collateral: inputCollateral,
  response: (payload) => otherAxon.some.createSignal(payload),
});
```

Correct (controller-owned request, domain emits its own):

```ts
const controller = neuron({ requestA });
const serviceA = neuron({ doneA })
  .dendrite({ collateral: requestA, response: (payload, axon) => axon.doneA.createSignal(payload) });
// controller emits requestA; serviceA emits doneA
```

### `neuron.dendrite({...})`
Add a dendrite bound to a collateral.

```ts
const myNeuron = neuron({ output: myCollateral }).dendrite({
  collateral: inputCollateral,
  response: async (payload, axon, ctx) => {
    // ctx: { abortSignal, cns, stimulation, stimulationContext, activationContext }
    if (ctx.abortSignal?.aborted) return;
    // Business/run data flows through payloads; dependencies come from a factory function (see Dependencies)
    return axon.output.createSignal(payload);
  }
});
```

### `neuron.bind(axon, map)`
Exhaustive bind to every collateral of another neuron's axon (compile-time safety).

```ts
// Data flows through signal payloads; dependencies come from a factory function (see Dependencies).
neuron({})
  .bind(order, {
    created: (payload, axon) => { /* ... */ },
    updated: (payload) => { /* ... */ },
    cancelled: (payload) => { /* ... */ },
  });
```

### `neuron.setConcurrency(n: number | undefined)`
Set per-neuron global concurrency limit (shared across all parallel stimulations).

```ts
const limitedWorker = neuron({ out })
  .setConcurrency(2) // max 2 parallel executions across all runs
  .dendrite({ collateral: task, response: async (p, axon) => { /* ... */ } });
```

This limits how many concurrent executions of this neuron's dendrites can run at the same time, even across different `stimulate()` calls. Useful for rate-limiting external APIs or heavy I/O operations.

### `neuron.setMaxDuration(ms: number | undefined)`
Set maximum execution duration for this neuron's dendrites. If exceeded, the dendrite execution will be aborted.

```ts
const timedWorker = neuron({ out })
  .setMaxDuration(5000) // 5 seconds max
  .dendrite({ collateral: task, response: async (p, axon) => { /* ... */ } });
```

### Dependencies: a store, a database, a clock

Per-run data travels in signal payloads. Dependencies the handlers use, such as a store, a database client or a clock, reach a neuron in one of two ways.

**Recommended: a factory function.** The neuron closes over its dependencies, so the handler signature stays `(payload, axon)` and TypeScript checks what you pass. Each CNS gets its own instances, for example one database per CNS:

```ts
const appUpserted = collateral<TApp>();

export const createAppsNeuron = (db: TDb) =>
  neuron({}).dendrite({
    collateral: appUpserted,
    response: app => {
      db.apps.upsertEntityByKey(app.id, app);
    },
  });

const appNeuronFactories = [createAppsNeuron];

const cnsA = createCNS(appNeuronFactories, dbA);
const cnsB = createCNS(appNeuronFactories, dbB);
```

`createCNS(neuronFactories, dependencies, options?)` calls every factory with the same dependencies and builds the CNS from the neurons they return. Each neuron can live in its own file as a factory; the app lists the factories once. TypeScript checks `dependencies` against the parameter of every factory, so a factory that needs something else does not compile. `new CNS([createAppsNeuron(dbA)])` builds the same CNS by hand.

Keep the collaterals at module level, outside the factory. They are how other code reaches the neuron, and every CNS built from the factory has to share them. Call each factory once per CNS: `createCNS` throws when one is listed twice. With `new CNS`, two neurons from one factory both own its collaterals and the constructor throws, and without collaterals every dendrite runs twice. `createCNS` passes no `global`; neurons declared with `withGlobal<T>()` go through `new CNS(neurons, options, global)`.

**`ctx.global`: for neurons already declared as module values.** If your neurons are module-level constants and you do not want to rewrite them as factories, declare them through `neuronFactory().withGlobal<T>()` and pass the value as the third argument of `new CNS` (or as `global` in `CNSFactory.create({ appsNeuron }, { global })`). It arrives in every handler as `ctx.global`:

```ts
const { neuron: globalNeuron } = neuronFactory().withGlobal<{ db: TDb }>();

const appUpserted = collateral<TApp>();

export const appsNeuron = globalNeuron({}).dendrite({
  collateral: appUpserted,
  response: (app, _axon, { global }) => {
    global.db.apps.upsertEntityByKey(app.id, app);
  },
});

const cnsA = new CNS([appsNeuron], undefined, { db: dbA });
const cnsB = new CNS([appsNeuron], undefined, { db: dbB });
```

TypeScript does not check the value given to `new CNS` or `CNSFactory.create` against the type declared with `withGlobal<T>()`. A missing or wrong value shows up only when a handler runs.

### `CNS`
Main orchestrator. `new CNS(neurons, options?, global?)`. `global` is the value handlers read as `ctx.global` (see [Dependencies](#dependencies-a-store-a-database-a-clock)).

**Constructor options:** see `TCNSOptions`.

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
const tasks: TCNSNeuronActivationTask<TCNSNeuron>[] = [
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
  modality,                    // Optional: modality selection for modalityDendrite
  afferentPath,                // Optional: afferent path selection for modalityDendrite
});
await stimulation.waitUntilComplete();
```

#### Response shape (for listeners)
Both `onResponse` and global listeners receive the same object:

```ts signature
{
  inputSignal?: TCNSSignal;    // when a signal is ingested
  outputSignal?: TCNSSignal;   // when a dendrite returns a continuation
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

An activation is *pending* until its dendrite response is invoked, then *active*
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

Several stimulations started from one place — the answers of one request batch, the timers due in one tick — commit once inside `cns.batch(run)`: the drains of the stimulations started in it are announced, in their order, when the outermost `batch` ends (also when `run` throws). The first flush commits every write; the ones after it find nothing to do. `batch` covers what `run` does synchronously: a turn that comes after an `await` inside `run`, or after `batch` returned, is announced on its own. It is the `batch` of Redux and of React DOM, and `transaction` in MobX.

```ts
cns.batch(() => {
  cns.stimulate(requestA.createSignal({ id: 'a' }));
  cns.stimulate(myCollateral.createSignal({ id: 'b' }));
}); // one commit for both
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

```ts signature
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
const stimulation = cns.stimulate(signal);
await stimulation.waitUntilComplete();
```

#### `stimulation.getOutstandingTasks()`
Get the current outstanding frontier — not-yet-completed tasks (queued, active, pending) plus failed/aborted ones. This is the set to persist for resume: re-activating it via `cns.activate(tasks)` re-runs exactly the not-yet-done work. Each task carries its own input signal (with payload), so no extra state is needed.

```ts
const stimulation = cns.stimulate(signal);
const frontier = stimulation.getOutstandingTasks();
```

#### `stimulation.getFailedTasks()`
Get all tasks that failed or were aborted.

```ts
const stimulation = cns.stimulate(signal);
const failures = stimulation.getFailedTasks();
failures.forEach(f => console.error(f.error));
```

### `cns.network` — Network Graph Analysis

Access network analysis utilities:

```ts
// Get subscribers for a collateral
const subscribers = cns.network.getSubscribers(userCreated);

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
