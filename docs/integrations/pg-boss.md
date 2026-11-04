---
id: pg-boss
title: pg-boss (Postgres) Integration
sidebar_label: pg-boss
slug: /integrations/pg-boss
---

> **⚠️ Experimental**: The `@cnstra/pg-boss` package is experimental. The API may change.

[pg-boss](https://github.com/timgit/pg-boss) is a job queue built on PostgreSQL. If you're
already on Postgres and want resumable jobs, retries, backoff, scheduling and singleton
guarantees **without adding Redis**, it pairs well with CNStra.

This guide mirrors the [BullMQ guide](/docs/integrations/bullmq): the core
model is **one job = one stimulation**. The one thing you must get right for a queue is that
CNStra's runtime uses **object identity** for neurons/collaterals and stores context as a
`Map<object, unknown>` — those references are **not portable across processes**. So jobs carry
**names** (resolved through a `CNSPersistOptionsRegistry`), never serialized tasks or context.

The `@cnstra/pg-boss` package packages the pattern below; you can also wire it by hand.

```bash
npm install @cnstra/pg-boss @cnstra/core @cnstra/factory pg-boss
```

```ts setup
import { PgBoss } from 'pg-boss';
import type { CNS } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSNeuron } from '@cnstra/types';
import { createCNSWorker, enqueueCNSStimulation } from '@cnstra/pg-boss';
import type { TCNSStimulationJobData, TCNSWorkerOptions } from '@cnstra/pg-boss';

declare const DATABASE_URL: string;
declare const boss: PgBoss;
declare const cns: CNS<TCNSNeuron<any>>;
declare const registry: CNSPersistOptionsRegistry;
declare const job: TCNSStimulationJobData;
declare const resume: TCNSWorkerOptions['resume'];
```

## Basic integration

```ts file=worker.ts
import { PgBoss } from 'pg-boss';
import { collateral, neuron } from '@cnstra/core';
import { CNSFactory } from '@cnstra/factory';
import { createCNSWorker, enqueueCNSStimulation, stimulationJob } from '@cnstra/pg-boss';

const importUser = collateral<{ userId: string }>();
const importUserNeuron = neuron({}).dendrite({ collateral: importUser, response: async () => {} });

// Build the CNS and a registry from one map so names can't drift
const { cns, registry } = CNSFactory.create({
  importUserNeuron,
  importUser,
  // …other neurons
});

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue('cns');

// Worker: one job → one stimulation
await createCNSWorker({ boss, cns, registry, queue: 'cns' });

// Producer: enqueue by (registered) collateral name
const job = stimulationJob(registry, importUser, { userId: '42' });
await enqueueCNSStimulation(boss, 'cns', job);
```

A job can run on an afferent path: `stimulationJob(registry, collateral, payload, { modality, afferentPath })`, or `{ from: ctx }` inside a neuron body to keep the path of the current run. Register the modality with `registry.registerModality(name, modality)`.

Under the hood the worker does exactly what the BullMQ guide shows, just resolved by
name:

```ts
await boss.work<TCNSStimulationJobData>('cns', async ([job]) => {
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
await enqueueCNSStimulation(boss, 'cns', job, {
  retryLimit: 5,
  retryBackoff: true,
  singletonKey: 'user:42',
});
```

## Retries & resume

pg-boss reuses the **same job id** across a job's retries, so a run = stimulation = job and
the checkpoint is keyed by **job id**. Three levels:

- **Whole-flow retry (recommended default).** Omit `resume`. A retried job re-derives the
  entry signal by name and re-runs the flow. Make neurons **idempotent**.
- **Resumable frontier resume (across restarts).** Pass a `resume.repository` and the worker
  records the outstanding frontier as the run advances; a retried job continues via
  `cns.activate(...)` instead of re-running from the entry — only the unfinished branch runs.

  ```ts
  import { CNSPgBossProgressRepository } from '@cnstra/pg-boss/postgres-progress';

  await createCNSWorker({
    boss, cns, registry, queue: 'cns',
    resume: { repository: new CNSPgBossProgressRepository({ connectionString: DATABASE_URL }) },
  });
  ```

  pg-boss's `Job` has no mutable native progress field (unlike BullMQ), so the checkpoint
  lives in its own table (`cns_pgboss_progress`, keyed by job id). Auto-created on first use,
  or manage it yourself: `DATABASE_URL=… npx cnstra-pgboss-progress migrate`. The store is
  **pluggable** — swap in [`@cnstra/progress-redis`](/docs/integrations/bullmq) or
  any `ICNSProgressRepository`. See [Resumable execution](/docs/advanced/resumable-execution) for
  how `resume` (frontier) relates to `observe` (history).
- **In-process partial resume.** `cns.activate(stimulation.getFailedTasks(), …)` resumes only
  the failed branch, but the failed tasks hold **live object references** — same process only.
  Across processes use the resumable execution above.

**Row lifecycle / cleanup.** One upserted row per `job.id`; the worker **deletes it on
success**. A job that fails *permanently* (retries exhausted) keeps its row — pg-boss has no
terminal-failure hook — so prune those by staleness (a still-retrying job keeps `updated_at`
fresh, so pick a threshold above your longest retry window):

```ts
import { CNSPgBossProgressRepository } from '@cnstra/pg-boss/postgres-progress';

const store = new CNSPgBossProgressRepository({ connectionString: DATABASE_URL });
await store.deleteStale(24 * 60 * 60 * 1000); // e.g. a daily cron
```

## Batches

pg-boss can hand a worker several jobs at once (`workOptions.batchSize`), and it settles that
batch as one unit: a handler that throws fails **every** job id in it. So the worker runs each
job in the batch on its own — one failure neither skips the jobs behind it nor re-runs the ones
ahead of it. The jobs that finished are completed before the failure is reported, and only the
failures go to retry.

```ts
await createCNSWorker({
    boss, cns, registry, queue: 'cns',
    workOptions: { batchSize: 20 },
});
```

Jobs in a batch run one after another, not concurrently — the batch is how many the worker
fetches per round trip, not how many stimulations run at once. Use pg-boss's own concurrency
options for that.

## Graceful shutdown

`createCNSWorker` resolves to `{ workId, shutdown }`. On `SIGTERM`/`SIGINT` call `shutdown()`:
it stops taking new jobs, lets in-flight stimulations finish, then **aborts** the rest — their
remaining tasks become the frontier, the resume checkpoint records it, and the job's retry
resumes there. It does **not** stop your `boss` or close your stores — you own those, so stop
the boss and close stores after it resolves (checkpoint lands first).

`drainMs` (default 10s) is the budget for the whole shutdown, and it is a real bound: half goes
to finishing on their own, half to writing the checkpoints of whatever had to be aborted. It is
split rather than extended because the deadline that matters is on the shutdown as a whole — a
container's termination grace period — and a shutdown that overruns it is killed mid-write,
losing the checkpoint the drain existed to produce. A stimulation whose neuron ignores the abort
signal (an HTTP call with no signal wired through, say) therefore costs you the second half and
nothing more; it cannot hold the process open.

```ts
const { shutdown } = await createCNSWorker({ boss, cns, registry, queue: 'cns', resume });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await shutdown({ drainMs: 15_000 }); // abort + checkpoint in-flight
    await boss.stop();                    // you own the boss
    // await pgStore.close();             // then your stores
    process.exit(0);
  });
}
```

## Non-serializable data

Queue payloads must be JSON (pg-boss stores `jsonb`). Keep blobs/handles in-process: a
"controller" neuron holds them and launches an **inner stimulation** via `ctx.cns.stimulate(...)`,
while only serializable IDs go on the queue. This is the same pattern as the
[BullMQ guide](/docs/integrations/bullmq#non-serializable-data).

## Observability & an admin panel

You don't hand-roll a schema. Pass an **`observe`** store and the worker records the canonical
name-based **Stimulation → Attempt → Task** model — the exact same model the DevTools render —
via a `CNSStimulationPersistor`. One job = one stimulation (`stimulationId` = job id); each pg-boss
retry = a new attempt. It's independent of `resume`: `observe` is the history you look at, `resume`
is the frontier the retry continues from.

```ts
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
// keep it: import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';

const history = new CNSInMemoryStimulationRepository(); // or the Postgres store below

await createCNSWorker({
  boss, cns, registry, queue: 'cns',
  observe: history,           // ← records run/attempt/task by name
  // resume: { repository: … } // ← optional, independent: frontier checkpoint for retries
});

// read it back — a neuron-by-neuron waterfall, ready for an admin screen:
const runs = await history.listStimulations();               // newest-first roster
const attempts = await history.getAttempts(runs[0].stimulationId);
const tasks = await history.getTasks(attempts[0].stimulationAttemptId);
```

To **keep** it across restarts, use `CNSPostgresStimulationRepository` from
[`@cnstra/persist-postgres`](https://www.npmjs.com/package/@cnstra/persist-postgres) — it owns the
relational run/attempt/task tables (`cnstra-persist-postgres migrate`, or auto-created), so there is
no schema to write yourself.

> **Shortcut — the DevTools Explorer as a persistent admin.** The CNStra DevTools already render this
> exact model. Hand the worker to `startCNSDevTools` and every job it processes shows up live in the
> Explorer — filterable by job type (entry collateral) or neuron, with a per-run attempt/task
> waterfall — and Retry / Clone go through pg-boss under the same job id. No bespoke UI:
> ```ts
> import { startCNSDevTools } from '@cnstra/devtools-server';
>
> const worker = await createCNSWorker({ boss, cns, registry, queue: 'cns' });
> await startCNSDevTools(worker);
> // → open the printed URL, 20 job types = 20 entry-collateral facets.
> ```
> The panel records each job once, under its job id, through its in-process link, into a bounded
> in-memory history by default; pass a `CNSPostgresStimulationRepository` as `stimulationRepository`
> to keep it across restarts. An admin in a separate process reads the worker's `observe` store
> instead: give it the same store as `stimulationRepository`. To mount it in your own server behind your
> auth, see [Admin](/docs/devtools/admin).

The three admin screens fall straight out of the model — and are what the panel already renders:

1. **Live runs** — the `listStimulations` roster, each with its status and resumable frontier.
2. **Run timeline** — a stimulation's attempts, and each attempt's task waterfall (neuron by neuron,
   payloads in/out, errors). The single most useful artifact for debugging a flow.
3. **Failures & retries** — a failed run's outstanding frontier + a **Retry** that resumes only the
   unfinished branch, or **Clone** for a fresh run from the entry.

## pg-boss vs. your own Postgres utility?

Separate two concerns:

- **Execution / delivery** (who runs the stimulation, retries, backoff, cron, singleton,
  concurrency): pg-boss solves this natively on Postgres. Reinventing `SELECT … FOR UPDATE SKIP
  LOCKED` + backoff + scheduling + archival is a lot of subtle work — **use pg-boss**.
- **Progress / history** (resumable per-step records, admin): pg-boss has no per-step model, so
  this is **always your own tables** regardless. The `progress` sink above is that layer.

Roll your own queue only if you specifically need the job and its trace to be the same
row/transaction, or you have visibility semantics that clash with pg-boss. Otherwise:
**pg-boss for execution + a thin progress store for history/admin.**

## Tips

- Build `cns` + `registry` together with `CNSFactory.create(...)` so names never drift.
- Use pg-boss concurrency/rate limits for backpressure; keep neurons idempotent.
- Save progress on every hop only if you need a live admin; otherwise checkpoint on errors
  and milestones to reduce write load.
- Wire `expireInSeconds`/cancellation to an `AbortController` passed as `abortSignal`.
