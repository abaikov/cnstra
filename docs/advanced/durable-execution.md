---
id: durable-execution
title: Durable execution — runs, attempts & tasks
sidebar_label: Durable execution
slug: /advanced/durable-execution
description: The name-based Stimulation → Attempt → Task model, and the two independent seams — resume (frontier checkpoint) and observe (run history) — that make CNStra flows durable and inspectable.
keywords: [durable execution, stimulation, attempt, task, resume, observe, persist, persist-postgres, CNSStimulationPersistor, ICNSStimulationRepository, retry, clone, scopeName]
---

[Persistence & Resume](./persistence.md) covers the low-level primitive: serialize a
stimulation's outstanding **frontier** so a retry continues where it stopped. This page is
the layer on top — the **name-based run model** CNStra records, and the two independent
choices you make per run: *do I checkpoint it for resume?* and *do I keep its history to
look at?*

## The model

Everything is keyed by **name** (neuron/collateral names from your registry) — topology is
never persisted, code is its source of truth.

| Concept | What it is | Id |
|---|---|---|
| **Stimulation** | the stable logical run a human retries | `stimulationId` (+ optional `scopeName`) |
| **Attempt** | one execution of it (a `stimulate` / `activate`) | `attemptNumber` |
| **Task** | one settled hop within an attempt | ordinal `index` |

A retry is a new **Attempt** of the same **Stimulation**. `(stimulationId, attemptNumber)`
is unique. Roughly: **Stimulation ≈ a Temporal Workflow**, **Attempt ≈ a Run**.

`scopeName` is optional and identifies the CNS/graph a run belongs to — leave it unset and
everything lives in one default scope; set it to isolate names and route auto-resume when
one process hosts several graphs.

## Two independent seams

On a queue worker (`@cnstra/pg-boss` / `@cnstra/bullmq`) these are separate options — use
either, both, or neither:

```ts
await createCNSWorker({
  boss, cns, registry, queue: 'cns',
  resume:  { repository: checkpointStore }, // frontier checkpoint → restart continues
  observe: historyStore,                    // run/attempt/task history → inspect it
});
```

- **`resume`** — the *frontier* (what's left to do), a cheap key→blob checkpoint
  (`ICNSProgressRepository`). A retried job continues via `cns.activate(...)` instead of
  re-running from the entry. Omit it and a retry just re-runs the whole flow (make neurons
  idempotent).
- **`observe`** — the *history* (what happened): the full Stimulation → Attempt → Task
  model written to an `ICNSStimulationRepository`. This is exactly what the DevTools render
  and what a retry admin lists.

They are orthogonal because they answer different questions — "where do I continue?" vs
"what happened?" — and often need different storage shapes (a one-blob checkpoint vs a
relational history).

## Where the history lives

`observe` (and the DevTools server) take any `ICNSStimulationRepository`:

```ts
// See it in-process (ephemeral) — @cnstra/persist
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';

// Keep it across restarts — @cnstra/persist-postgres (owns the run/attempt/task tables)
import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';
const history = new CNSPostgresStimulationRepository({ connectionString: DATABASE_URL });
// tables: `cnstra-persist-postgres migrate`, or auto-created on first use.
```

Read it back — a ready-made admin waterfall, no schema to write:

```ts
const runs     = await history.listStimulations();            // newest-first roster
const attempts = await history.getAttempts(runs[0].stimulationId);
const tasks    = await history.getTasks(attempts[0].stimulationAttemptId);
```

### ⚠️ Bound the in-memory store or you will OOM {#bound-in-memory}

`CNSInMemoryStimulationRepository` retains every run forever by default — fine for tests,
**fatal for a long-running process**. Always pass a bound for `observe`:

```ts
new CNSInMemoryStimulationRepository({
  maxStimulations: 1000,   // evict least-recently-updated beyond the cap (+ its attempts/tasks)
  ttlMs: 60 * 60 * 1000,   // evict runs idle longer than this (lazy sweep on writes)
  deleteOnComplete: true,  // "live only": drop a run the moment it settles (completed OR failed)
});
```

Use `deleteOnComplete` when you only watch in-flight runs; use `maxStimulations` / `ttlMs`
to keep a bounded *recent* history (e.g. to still inspect or retry failed runs). The
Postgres store has no such limit — rows persist; prune with your own retention policy.

## Retry & clone

Given a run's history you get two admin actions for free (this is what the DevTools
[Durable Runs](../devtools/durable-runs.md) panel does):

- **Retry** — resume the outstanding **frontier** as a new attempt; only the unfinished
  branch re-runs, with its context.
- **Clone** — a fresh run from the original **entry** (a clean re-do).

## One CNS, two call sites {#one-cns-two-call-sites}

Durability is attached **per `stimulate()` call**, not baked into the CNS — the CNS is a
pure graph. So the *same* `cns` can run durably from a worker and plainly from, say, an
HTTP endpoint:

```ts
const cns = new CNS([...]); // one instance for the whole app

// durable: from the queue worker (persistor + resume + observe wired for you)
createCNSWorker({ boss, cns, registry, queue, resume, observe });

// plain: same cns, no persistence
app.post('/do', (req, res) => { cns.stimulate(entry.createSignal(req.body)); res.sendStatus(202); });
```

Each `stimulate` is an independent stimulation (its own context + queue); nothing crosses
over. Two caveats about what *is* shared on the CNS instance: the **per-neuron concurrency
gate** (both call sites contend on it — usually the point) and **`ctx.global`** (app-wide
by design). Note also that a *global* `cns.addResponseListener` (what the DevTools attach)
observes **all** stimulations, whereas a per-call `onResponse`/`observe` is selective — so
durability stays on the worker path only if you attach it per-call, which the worker does.

## See also

- [Log correlation](../recipes/log-correlation.md) — tag logs with the `stimulationId` /
  `attemptNumber` (the workers fill it automatically).
- [Persistence & Resume](./persistence.md) — the underlying frontier-serialization primitive.
- [DevTools → Durable Runs](../devtools/durable-runs.md) — the panel that renders this model.
- [pg-boss](../integrations/pg-boss.md) / [message brokers](../integrations/message-brokers.md) — the worker integrations.
