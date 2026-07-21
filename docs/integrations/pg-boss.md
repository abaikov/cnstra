---
id: pg-boss
title: pg-boss (Postgres) Integration
sidebar_label: pg-boss
slug: /integrations/pg-boss
---

> **⚠️ Experimental**: The `@cnstra/pg-boss` package is experimental. The API may change.

[pg-boss](https://github.com/timgit/pg-boss) is a job queue built on PostgreSQL. If you're
already on Postgres and want durable jobs, retries, backoff, scheduling and singleton
guarantees **without adding Redis**, it pairs well with CNStra.

This guide mirrors the [Message Brokers guide](/docs/integrations/message-brokers): the core
model is **one job = one stimulation**. The one thing you must get right for a queue is that
CNStra's runtime uses **object identity** for neurons/collaterals and stores context as a
`Map<object, unknown>` — those references are **not portable across processes**. So jobs carry
**names** (resolved through a `CNSPersistOptionsRegistry`), never serialized tasks or context.

The `@cnstra/pg-boss` package packages the pattern below; you can also wire it by hand.

```bash
npm install @cnstra/pg-boss @cnstra/core pg-boss
```

## Basic integration

```ts
import PgBoss from 'pg-boss';
import { createCNS } from '@cnstra/core';
import { createCNSWorker, enqueueStimulation, stimulationJob } from '@cnstra/pg-boss';

// Build the CNS and a registry from one map so names can't drift
const { cns, registry } = createCNS({
  importUser: importUserNeuron,
  // …other neurons
});

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue('cns');

// Worker: one job → one stimulation
await createCNSWorker({ boss, cns, registry, queue: 'cns' });

// Producer: enqueue by (registered) collateral name
const job = stimulationJob(registry, importUser, { userId: '42' });
await enqueueStimulation(boss, 'cns', job);
```

Under the hood the worker does exactly what the message-brokers guide shows, just resolved by
name:

```ts
await boss.work('cns', async ([job]) => {
  const { collateralName, payload } = job.data;
  const collateral = registry.getCollateral(collateralName);
  if (!collateral) throw new Error(`Unknown collateral: ${collateralName}`);

  const stimulation = cns.stimulate(collateral.createSignal(payload));
  await stimulation.waitUntilComplete(); // rejects on failure/abort → pg-boss retries
});
```

Because `waitUntilComplete()` **rejects** when a stimulation has failed tasks or was aborted,
letting the error propagate is exactly what you want: pg-boss then applies its retry/backoff.

## pg-boss features worth wiring

| pg-boss option | CNStra use |
| --- | --- |
| `retryLimit` / `retryBackoff` / `retryDelay` | Retry the whole (idempotent) stimulation |
| `singletonKey` | One in-flight stimulation per entity (e.g. per `userId`) |
| `boss.schedule(...)` (cron) / `startAfter` | Scheduled / deferred stimulations |
| `expireInSeconds` | Wire to an `AbortController` → `stimulate(signal, { abortSignal })` |
| dead-letter queue | Park terminally failed runs; store `getFailedTasks()` (by name) |

```ts
await enqueueStimulation(boss, 'cns', job, {
  retryLimit: 5,
  retryBackoff: true,
  singletonKey: 'user:42',
});
```

## Retries & resume

There are two levels, and only one is safe across processes:

- **Whole-flow retry (recommended).** A retried job re-derives the entry signal by name and
  re-runs the flow. Make neurons **idempotent**, or deduplicate work with a per-hop unique key
  (see `unique (stimulation_id, index)` below).
- **In-process partial resume.** `cns.activate(cns_stimulation.getFailedTasks(), …)` resumes only
  the failed branch, but the failed tasks hold **live object references** — this works **only in
  the same process**. Don't try to ship tasks/context through the queue. For resumable context
  across processes you need a name-keyed serializable context store (see
  [Custom Context Store](/docs/advanced/custom-context-store)).

## Non-serializable data

Queue payloads must be JSON (pg-boss stores `jsonb`). Keep blobs/handles in-process: a
"controller" neuron holds them and launches an **inner stimulation** via `ctx.cns.stimulate(...)`,
while only serializable IDs go on the queue. This is the same pattern as the
[Message Brokers guide](/docs/integrations/message-brokers#non-serializable-data).

## Per-step progress & an admin panel

CNStra already emits everything an admin needs, per step, via `onResponse` (or the global
`cns.addResponseListener`). Each response exposes the input/output signal, any error, the
current `queueLength`, and (when `maxNeuronHops` is set) the hop count. This is the same data
the DevTools stream models as `stimulation.started` / `stimulation.hop` / `stimulation.completed`.
An admin panel is essentially **durable DevTools**: persist those events to Postgres.

> **Shortcut — durable DevTools out of the box.** If you already run the CNStra DevTools
> server, you don't have to hand-roll the store below. Swap its in-memory repository for
> [`@cnstra/devtools-server-repository-postgres`](https://www.npmjs.com/package/@cnstra/devtools-server-repository-postgres)
> or [`@cnstra/devtools-server-repository-redis`](https://www.npmjs.com/package/@cnstra/devtools-server-repository-redis)
> — same `ICNSDevToolsServerRepository` contract, but stimulations and hops survive restarts,
> and the existing DevTools panel becomes a persistent admin view:
> ```ts
> import { CNSDevToolsServer } from '@cnstra/devtools-server';
> import { CNSDevToolsServerRepositoryPostgres } from '@cnstra/devtools-server-repository-postgres';
> const repo = new CNSDevToolsServerRepositoryPostgres(pgPool);
> await repo.init();
> const server = new CNSDevToolsServer(repo);
> ```
> The schema below is for when you want your **own** progress tables (independent of DevTools).

`@cnstra/pg-boss` exposes a `progress` sink for this. The key detail: **if `onHop` returns a
Promise, CNStra waits for it before enqueuing the next hop** — a per-hop checkpoint barrier. So
each step is durably committed *before* the flow advances, and after a crash the DB reflects
exactly how far the run got.

```ts
await createCNSWorker({
  boss, cns, registry, queue: 'cns',
  progress: {
    onStarted:   (s) => db.insertStimulation(s), // { jobId, collateralName, payload, startedAt }
    onHop:       (h) => db.insertHop(h),          // one row per step (see schema)
    onCompleted: (s) => db.finishStimulation(s),  // status: completed | failed, hopCount
  },
});
```

Suggested schema (your own tables — pg-boss has no per-step progress of its own):

```sql
create table cns_stimulation (
  id uuid primary key,
  job_id text,
  collateral_name text not null,
  payload jsonb,
  status text not null,              -- running | completed | failed | aborted
  started_at timestamptz,
  completed_at timestamptz,
  hop_count int default 0,
  error text
);

create table cns_hop (
  id bigserial primary key,
  stimulation_id uuid references cns_stimulation(id),
  index int not null,
  neuron_name text,
  input_collateral text,
  output_collateral text,
  input_payload jsonb,
  output_payload jsonb,
  started_at timestamptz,
  duration_ms int,                   -- core does not time hops; stamp it yourself if needed
  error text,
  unique (stimulation_id, index)     -- makes retries/replay idempotent
);
```

Names come from the registry (`registry.getNeuronName`, `registry.getCollateralName`), exactly
like DevTools derives its ids — so the same registry powers execution, resume, and the admin.

Three natural admin screens fall out of this:

1. **Live runs** — `status = 'running'`, with `hop_count`, last neuron, and `queueLength`.
2. **Run timeline** — the ordered `cns_hop` rows for one stimulation: a neuron-by-neuron
   waterfall of payloads in/out and errors. The single most useful artifact for debugging a flow.
3. **Failures & retries** — `status = 'failed'`, the failed tasks (by name), the pg-boss attempt
   count, and a "replay" action that simply re-enqueues the job (idempotent).

## pg-boss vs. your own Postgres utility?

Separate two concerns:

- **Execution / delivery** (who runs the stimulation, retries, backoff, cron, singleton,
  concurrency): pg-boss solves this natively on Postgres. Reinventing `SELECT … FOR UPDATE SKIP
  LOCKED` + backoff + scheduling + archival is a lot of subtle work — **use pg-boss**.
- **Progress / history** (durable per-step records, admin): pg-boss has no per-step model, so
  this is **always your own tables** regardless. The `progress` sink above is that layer.

Roll your own queue only if you specifically need the job and its trace to be the same
row/transaction, or you have visibility semantics that clash with pg-boss. Otherwise:
**pg-boss for execution + a thin progress store for history/admin.**

## Tips

- Build `cns` + `registry` together with `createCNS(...)` so names never drift.
- Use pg-boss concurrency/rate limits for backpressure; keep neurons idempotent.
- Save progress on every hop only if you need a live admin; otherwise checkpoint on errors
  and milestones to reduce write load.
- Wire `expireInSeconds`/cancellation to an `AbortController` passed as `abortSignal`.
