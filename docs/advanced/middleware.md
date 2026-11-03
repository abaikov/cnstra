---
id: middleware
title: Middleware chains
sidebar_label: Middleware chains
slug: /advanced/middleware
description: CNStra has two middleware chains — DevTools actions (what a Retry button does) and store writes (what reaches a stimulation store) — with deliberately different rules about calling next(), plus why response listeners are not a chain.
keywords: [middleware, chain, TCNSDevToolsActionMiddleware, TCNSStimulationWriteMiddleware, withCNSWriteChain, retryCNSWrites, redactCNSPayload, capCNSPayload, onCNSResume, onCNSLaunch, barrier, response listeners]
---

CNStra has **two** middleware chains. They have the same shape — a link takes a
value and a `next()` — and one rule that differs, which is the whole reason they
are separate types rather than one generic helper.

| chain | type from | what flows through it | may a link call `next()` twice? |
| --- | --- | --- | --- |
| DevTools actions | `@cnstra/persist-dto` | a panel command (Retry / Clone) on its way to whatever can execute it | **no** — it throws |
| Store writes | `@cnstra/persist` | a stimulation / attempt / task record on its way to a store | **yes** — that is how the retry link works |

## DevTools actions

```ts setup
import { CNSStimulationPersistor } from '@cnstra/persist';
import type { ICNSStimulationWriter, TCNSStimulationPersistorOptions } from '@cnstra/persist';

declare const log: { info(fields: Record<string, unknown>, message: string): void };
declare const store: ICNSStimulationWriter;
declare const persistorOptions: TCNSStimulationPersistorOptions;
```

```ts signature
import type { TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';

type TCNSDevToolsActionMiddleware = (
    action: TCNSDevToolsAction,
    next: () => Promise<void>
) => Promise<void>;
```

Two action types:

| type | the panel's button | what a runtime must do |
| --- | --- | --- |
| `resume` | **Retry** | continue the run's outstanding frontier as attempt `attemptNumber` of the **same** stimulation — the ids are already assigned, so it must record under them rather than minting its own |
| `launch` | **Clone**, and a Replay | start a **new** run from an entry signal |

Clone and Replay are one type on purpose: they differ only in where the entry
signal came from — a source run, or a collateral and payload typed into the panel.
To something that executes runs, that is not a difference.

Two helpers narrow the union so a link needs no `switch`:

```typescript
import { onCNSResume, onCNSLaunch } from '@cnstra/persist-dto';

const auditRetries = onCNSResume(async (action, next) => {
    log.info({ stimulationId: action.stimulationId, attempt: action.attemptNumber }, 'retry');
    await next();          // pass it on, then carry on after the fact
});

const refuseClonesInProd = onCNSLaunch(async () => {
    // Return without calling next() — the action is declared handled, and
    // nothing further sees it.
});
```

The rules:

- **A link that acts and returns stops the chain.** That is how ownership works: a
  queue adapter asks its broker whether it holds the job and, if so, claims the
  action. Ownership needs no extra bookkeeping in the model.
- **A link that calls `next()` passes it on** — before, after or around its own
  work. `await next()` and then acting is a valid link; so is rewriting the action
  before passing it, or refusing it by not passing it.
- **If the chain runs out with nobody acting**, the caller reports that back to the
  panel as a rejection. Better than a button that says accepted and does nothing.
- **Calling `next()` twice throws.** Re-entering the tail would re-execute whatever
  already acted — a second `job.retry()`, a second run. It is a programming error,
  not a retry strategy, so it fails loudly.

A chain of responsibility (`handle(): boolean`) would cover only the first rule.
Wrapping a built-in link to log, authorize or refuse needs the middleware form.

Where the chain is installed, and what the shipped broker links do, is in
[Running DevTools in a real deployment](../devtools/deployments.md).

## Store writes

```ts signature
import type { TCNSStimulationWriteMiddleware } from '@cnstra/persist';

type TCNSStimulationWriteMiddleware = (
    write: TCNSStimulationWrite,     // { kind: 'stimulation' | 'attempt' | 'task', record }
    next: () => Promise<void>
) => Promise<void>;
```

`withCNSWriteChain(links, store)` returns an ordinary `ICNSStimulationWriter`, so it
drops in wherever a store goes — including inside a `CNSFanOutStimulationWriter`
branch:

```typescript
import { withCNSWriteChain, retryCNSWrites, redactCNSPayload, capCNSPayload } from '@cnstra/persist';

const repository = withCNSWriteChain(
    [retryCNSWrites({ attempts: 3 }), redactCNSPayload(['card', 'token']), capCNSPayload(64_000)],
    store
);
```

Shipped links:

| link | what it does | the cost |
| --- | --- | --- |
| `retryCNSWrites({ attempts, delayMs, onError })` | retries a failing write with exponential backoff; rethrows after the last try | holds the write path open for up to the full backoff — under a `barrier` that is the run waiting |
| `redactCNSPayload(keys, replacement?)` | replaces the value at each named key, at any depth, in the record's payloads | matches by key name only, so it over-redacts by design — a redaction that misses is worse |
| `capCNSPayload(maxBytes, replacement?)` | drops a payload that serializes past `maxBytes`, keeping the record | the payload is gone from the panel and from anything reading the store; `replacement` marks where |

Here **calling `next()` more than once is allowed**, and `retryCNSWrites` is exactly
that: it replays the tail of the chain until the store accepts. It is safe because
the writes are idempotent by construction — a stimulation and an attempt are
upserts by id, and a task is keyed by `(stimulationAttemptId, index)`. Replaying
one cannot duplicate a row.

`redactCNSPayload` works on a **copy**. The live signal the run is still using is
never mutated, so a redaction cannot change what the flow does.

**Reads bypass the chain.** `getStimulation` goes straight to the store: a link
that rewrote a record on the way in has no business rewriting what resume reads
back out.

The three links compose in order, so put `retryCNSWrites` first if you want the
redaction and the cap applied once and the retry to replay the already-scrubbed
record.

## Where a chain does not belong

Response listeners (`addResponseListener`, and the per-run `onResponse`) are **not**
a chain, and should not become one.

The engine invokes every listener **synchronously, in the same tick**, collects
whatever promises come back, and awaits them together. So every listener that
snapshots the run's frontier snapshots the *same* instant. Serialising them into
a chain would break that twice over:

- a later link would snapshot a frontier that has already moved on, because an
  earlier link's await let the run advance;
- a slow trace exporter placed before the store would delay the store's write, and
  under a barrier, the run.

What listeners need is not ordering, it is the **option to block** — and they
already have it. An async listener parks the hop's subscribers until it settles,
which is the whole mechanism behind checkpointing. Ask for it explicitly:

```typescript
new CNSStimulationPersistor({ ...persistorOptions, barrier: true });
```

See [Persistence & Resume → per-hop barrier](./persistence.md#per-hop-barrier-exactly-resumable)
and [Response listeners](../recipes/response-listeners.md#async-listeners-are-a-barrier-this-is-how-checkpointing-works).

## Which chain do I want

| you want to | use |
| --- | --- |
| change what a **Retry / Clone** button does — route it to a broker, log it, authorize it, refuse it | the actions chain, third argument of `CNSDevToolsServer` |
| retry, redact, cap or dead-letter what reaches a **store** | the write chain, `withCNSWriteChain(links, store)` |
| block a hop until its checkpoint has landed | not a chain — `barrier: true` on `CNSStimulationPersistor` |

## See also

- [Running DevTools in a real deployment](../devtools/deployments.md) — the actions chain in a multi-replica service
- [Persistence & Resume](./persistence.md) — the barrier, and what a checkpoint contains
- [Resumable execution](./resumable-execution.md) — the Stimulation → Attempt → Task model these writes carry
