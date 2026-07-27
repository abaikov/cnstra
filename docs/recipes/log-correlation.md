---
id: log-correlation
title: Correlating logs with a stimulation
sidebar_label: Log correlation
slug: /recipes/log-correlation
description: Tag every log line inside a CNStra flow with the stimulation (run) it belongs to — synchronously, in the browser or on the server — via ctx.stimulationContext.
keywords: [logging, correlation, trace id, stimulationContext, request id, run id, AsyncLocalStorage, observability]
---

A neuron's `response` handler runs *inside* the flow, but the run's id (a queue
`job.id`, an HTTP request id, a durable `stimulationId`) is minted *outside* it. So the
first production question is always: **how do I tag my logs with the stimulation they
belong to?**

## The primitive: `ctx.stimulationContext`

Pass a value as `stimulationContext` when you start a stimulation; it is handed to **every
handler on every hop** as `ctx.stimulationContext` — the *same* object throughout the run.

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

`ctx.stimulationContext` is typed `unknown` (the neuron doesn't own the shape — the caller
does). Cast at the read site, or wrap your logger:

```ts
type RunCtx = { stimulationId: string; attemptNumber: number };
const runLog = (ctx: { stimulationContext?: unknown }, msg: string) =>
  logger.info({ ...(ctx.stimulationContext as RunCtx), msg });
```

## On the backend it's automatic

The queue workers fill `stimulationContext` for you, so **you write nothing**. Every log
line inside a job's flow already carries the id the durable store and the DevTools panel
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

Correlation is independent of persistence — you can tag logs with zero durable storage
(see [Durable execution](../advanced/durable-execution.md) for when you *do* want the run
recorded), and the same `cns` can run durably from a worker and plainly from an endpoint
(see [that page's "one CNS, two call sites"](../advanced/durable-execution.md#one-cns-two-call-sites)).
