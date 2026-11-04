---
id: log-correlation
title: Correlating logs with a stimulation
sidebar_label: Log correlation
slug: /recipes/log-correlation
description: Tag every log line inside a CNStra flow with the stimulation (run) it belongs to — synchronously, in the browser or on the server — via ctx.stimulationContext.
keywords: [logging, correlation, trace id, stimulationContext, request id, run id, AsyncLocalStorage, observability]
---

A neuron's `response` handler runs *inside* the flow, but the run's id (a queue
`job.id`, an HTTP request id, a resumable `stimulationId`) is minted *outside* it. So the
first production question is always: **how do I tag my logs with the stimulation they
belong to?**

## Two stores, one shape

There are two context stores, same shape, different life:

| store | lives | written by |
| --- | --- | --- |
| `ctx.stimulationContext` | the whole run | the caller, at `stimulate()` / `activate()` |
| `ctx.activationContext` | one activation | a response listener, before that activation runs |

Both are plain objects with string keys. Both travel with the serialized frontier,
so a run resumed in another process reads back what the previous attempt left —
whatever of it was portable. A live handle stays in the process that made it.

Keys are namespaced by convention where more than one writer can meet: an
integration keys itself by package name (`'@cnstra/persist-otel'`), a caller who
owns their own run does not have to.

## The primitive: `ctx.stimulationContext`

Pass a value as `stimulationContext` when you start a stimulation; it is handed to **every
handler on every hop** as `ctx.stimulationContext` — the *same* object throughout the run.

```ts setup
import { CNS, neuron } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { createCNSWorker, type ICNSPgBossLike } from '@cnstra/pg-boss';
import type { ICNSCollateral, TCNSNeuron } from '@cnstra/types';

declare const cns: CNS<TCNSNeuron<any>>;
declare const boss: ICNSPgBossLike;
declare const registry: CNSPersistOptionsRegistry;
declare const logger: { info(record: Record<string, unknown>): void };
declare const entryCol: ICNSCollateral<{ userId: string }>;
declare const payload: { userId: string };
declare const stimulationId: string;
declare const attemptNumber: number;
declare const input: ICNSCollateral<{ userId: string }>;
declare const userFetched: ICNSCollateral<{ userId: string }>;
declare const checkout: ICNSCollateral<unknown>;
declare function nextHop(): number;
declare const app: {
  post(
    path: string,
    handler: (req: { id: string; body: unknown }, res: { sendStatus(code: number): void }) => void,
  ): void;
};
```

```ts
cns.stimulate(entryCol.createSignal(payload), {
  stimulationContext: { stimulationId, attemptNumber }, // whatever you want to carry
});

// any neuron, any hop:
const importUser = neuron({ userFetched }).dendrite({
  collateral: input,
  response: (payload, axon, ctx) => {
    logger.info({ ...ctx.stimulationContext, msg: 'importing user' });
    //            ^ { stimulationId, attemptNumber }
    return axon.userFetched.createSignal(/* … */);
  },
});
```

It works **everywhere** — synchronous or async handlers, **browser or Node** — because it
is plain data attached to the stimulation object, not an ambient async mechanism. In
particular it is available in the very first *synchronous* hop, which matters for a
frontend where the whole flow runs sync.

> **Why not `AsyncLocalStorage`?** ALS (`node:async_hooks`) works, but only on the server
> and only for the async parts. It does not exist in the browser. `stimulationContext` is
> the environment-agnostic answer; reach for ALS only if you specifically want ambient
> propagation into non-CNStra async code on the backend.

## Per activation: `ctx.activationContext`

A response listener sees the activations a response is about to create, before
they run, and can attach something to each one:

```ts
cns.addResponseListener(response => {
  for (const task of response.scheduledActivationTasks ?? []) {
    (task.activationContext ??= {})['my-app'] = { hop: nextHop() };
  }
});

// the neuron that activation belongs to:
const hopReader = neuron({}).dendrite({
  collateral: input,
  response: (payload, axon, ctx) => {
    const mine = ctx.activationContext?.['my-app'];
    //    ^ { hop: 3 } — this activation's own, not its neighbour's
  },
});
```

The window is real, not a race: the engine builds those tasks *before* handing the
response to a listener and enqueues the very same objects afterwards — on the
synchronous path, after an async listener settles, and even after a listener
throws.

`ctx.stimulationContext` is a `Record<string, unknown>` (the neuron doesn't own the shape — the caller
does). Cast at the read site, or wrap your logger:

```ts
type RunCtx = { stimulationId: string; attemptNumber: number };
const runLog = (ctx: { stimulationContext?: unknown }, msg: string) =>
  logger.info({ ...(ctx.stimulationContext as RunCtx), msg });
```

## On the backend it's automatic

The queue workers fill `stimulationContext` for you, so **you write nothing**. Every log
line inside a job's flow already carries the id the resumable store and the DevTools panel
use — one id ties **log ↔ run/attempt/task store ↔ DevTools waterfall**.

```ts
// @cnstra/pg-boss and @cnstra/bullmq both set, on every stimulate/activate:
//   stimulationContext = { stimulationId: job.id, attemptNumber }
await createCNSWorker({ boss, cns, registry, queue: 'cns' /*, resume, observe */ });
```

`attemptNumber` is the retry number, so a log line points at the exact **attempt** in the
timeline, not just the run.

## On the frontend / a plain HTTP handler you pass it yourself

The same CNS stimulated outside a worker just supplies its own correlation id:

```ts
app.post('/checkout', (req, res) => {
  cns.stimulate(checkout.createSignal(req.body), {
    stimulationContext: { stimulationId: req.id }, // your request id
  });
  res.sendStatus(202);
});
```

Correlation is independent of persistence — you can tag logs with zero resumable storage
(see [Resumable execution](../advanced/resumable-execution.md) for when you *do* want the run
recorded), and the same `cns` can run resumably from a worker and plainly from an endpoint
(see [that page's "one CNS, two call sites"](../advanced/resumable-execution.md#one-cns-two-call-sites)).
