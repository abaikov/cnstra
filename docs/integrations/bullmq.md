---
id: bullmq
title: BullMQ
sidebar_label: BullMQ
slug: /integrations/bullmq
description: Run CNStra flows on a BullMQ (Redis) queue with @cnstra/bullmq — one job per stimulation, frontier resume across retries (native job progress or any store), and name-based observability.
keywords: [bullmq, redis, queue, worker, resume, observe, createCNSWorker, durable, retry]
---

`@cnstra/bullmq` runs each queue job as a CNStra stimulation. BullMQ owns delivery,
retry/backoff, scheduling, concurrency and rate-limits; CNStra owns the flow. With `resume`
a retried job **continues the outstanding frontier** instead of re-running from scratch.

One job = one stimulation. `stimulationId` = the BullMQ job id; each retry = a new attempt.

## Install

```bash
npm install @cnstra/bullmq @cnstra/core bullmq
```

## Worker

```ts
import { Worker } from 'bullmq';
import { createCNSWorker } from '@cnstra/bullmq';
import { CNS } from '@cnstra/core';
import { registry } from './neurons/registry';

const connection = { host: '127.0.0.1', port: 6379 };
const cns = new CNS([/* your neurons */]);

const worker = createCNSWorker({
  Worker,            // the BullMQ Worker class (passed in, so this package builds without bullmq)
  cns,
  registry,          // name ⇄ object, to reconstruct the entry signal by name
  queue: 'cns',
  connection,
  resume: {},        // ← frontier resume via BullMQ's OWN job progress (Redis); see below
});
```

The worker reconstructs the entry signal from the job's `collateralName`, stimulates, and
awaits completion. If the stimulation fails, the processor rejects and the error propagates
so **BullMQ applies its retry/backoff** — and, with `resume`, the retry picks up the frontier.

## Producer

```ts
import { Queue } from 'bullmq';
import { enqueueStimulation, stimulationJob } from '@cnstra/bullmq';

const queue = new Queue('cns', { connection });

// stimulationJob resolves the entry collateral to its registered NAME (portable on the queue)
const job = stimulationJob(registry, importUser, { userId: '42' });
await enqueueStimulation(queue, job, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
```

## Retries & resume

BullMQ reuses the **same job id** across a job's retries, so the frontier checkpoint keys off
it. Three levels:

- **Whole-flow retry.** Omit `resume` — a retried job re-runs the flow from the entry. Make
  neurons **idempotent**.
- **Frontier resume via native job progress (recommended).** `resume: {}` — the checkpoint
  lives in BullMQ's **own** per-job progress (`job.updateProgress` / `job.progress`, in Redis),
  carried across retries. Nothing to provision.
- **Frontier resume in an external store.** `resume: { repository }` — point it anywhere, e.g.
  a shared Redis via [`@cnstra/progress-redis`](https://www.npmjs.com/package/@cnstra/progress-redis):

  ```ts
  import { CNSRedisProgressRepository } from '@cnstra/progress-redis';
  resume: { repository: new CNSRedisProgressRepository({ connection }) }
  ```

Only the unfinished branch re-runs (`cns.activate(...)`), with its context. See
[Durable execution](/docs/advanced/durable-execution) for how `resume` (frontier) relates to
`observe` (history).

> **BullMQ vs pg-boss:** BullMQ's `Job` has a mutable native `progress` field, so the default
> `resume: {}` needs no extra table. pg-boss has none, so it uses a small Postgres table — see
> [pg-boss](/docs/integrations/pg-boss).

## Observability & an admin

Pass an `observe` store and the worker records the canonical name-based **Stimulation →
Attempt → Task** model — the same model the DevTools render — via a `CNSStimulationPersistor`.
It's independent of `resume` (history vs frontier).

```ts
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
// keep it: import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';

const history = new CNSInMemoryStimulationRepository({ maxStimulations: 1000 }); // bound it!

createCNSWorker({ Worker, cns, registry, queue: 'cns', connection, observe: history });

const runs = await history.listStimulations(); // roster for an admin screen
```

> ⚠️ Bound the in-memory store (`maxStimulations` / `ttlMs` / `deleteOnComplete`) or it will
> OOM a long-running worker — see
> [Durable execution → bounds](/docs/advanced/durable-execution#bound-in-memory). To keep the
> history across restarts, use `CNSPostgresStimulationRepository`. The DevTools panel renders
> this model directly — see [Durable Runs](/docs/devtools/durable-runs).

## Non-serializable data in signals {#non-serializable-data}

Queue payloads must be JSON. Keep blobs/handles/streams in-process: a "controller" neuron holds
them and launches an **inner stimulation** via `ctx.cns.stimulate(...)`, while only serializable
IDs travel on the queue. Same pattern as [pg-boss](/docs/integrations/pg-boss#non-serializable-data).

## Log correlation

The worker auto-fills `ctx.stimulationContext = { stimulationId: job.id, attemptNumber }`, so
every log line inside a flow carries the run id with zero wiring — see
[Log correlation](/docs/recipes/log-correlation).

## Graceful shutdown

`createCNSWorker` returns `{ worker, shutdown }`. On `SIGTERM`/`SIGINT` call `shutdown()`: it
stops taking new jobs, lets in-flight stimulations finish for up to `drainMs` (default 10s),
then **aborts** any still running — their remaining tasks become the frontier, the resume
checkpoint records it, and the job's retry resumes exactly there — and closes the worker. It
does **not** close your `observe`/`resume` stores (you own those).

```ts
const { worker, shutdown } = createCNSWorker({ Worker, cns, registry, queue: 'cns', connection, resume: {} });
worker.on('failed', () => {/* raw BullMQ worker, for events */});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await shutdown({ drainMs: 15_000 }); // drain, then abort+checkpoint the rest
    // await pgStore.close();            // then close YOUR stores/queue
    process.exit(0);
  });
}
```

## Tips

- Use BullMQ concurrency + rate-limits to protect downstream resources.
- Prefer `resume: {}` (native progress) + **idempotent** neurons.
- One runnable example: `npm run demo:bull` (worker) / `npm run demo:panel:bull` (worker +
  the DevTools panel) — see [runnable examples](/docs/examples/runnable).
