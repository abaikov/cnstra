---
id: bullmq
title: BullMQ
sidebar_label: BullMQ
slug: /integrations/bullmq
description: Run CNStra flows on a BullMQ (Redis) queue with @cnstra/bullmq — one job per stimulation, frontier resume across retries (native job progress or any store), and name-based observability.
keywords: [bullmq, redis, queue, worker, resume, observe, createCNSWorker, resumable, retry]
---

`@cnstra/bullmq` runs each queue job as a CNStra stimulation. BullMQ owns delivery,
retry/backoff, scheduling, concurrency and rate-limits; CNStra owns the flow. With `resume`
a retried job **continues the outstanding frontier** instead of re-running from scratch.

One job = one stimulation. `stimulationId` = the BullMQ job id; each retry = a new attempt.

Pass an explicit `jobId` to make that id a business key you can grep for —
see [Choosing the stimulation id](./opentelemetry.md#choosing-the-stimulation-id).
For traces and metrics over the same setup, see [OpenTelemetry](./opentelemetry.md).

## Install

```bash
npm install @cnstra/bullmq @cnstra/core bullmq
```

## Worker

```ts file=neurons/registry.ts
import { CNSPersistOptionsRegistry } from '@cnstra/persist';

export const registry = new CNSPersistOptionsRegistry();
```

```ts file=worker.ts
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
  workerOptions: { connection },
  resume: {},        // ← frontier resume via BullMQ's OWN job progress (Redis); see below
});
```

The worker reconstructs the entry signal from the job's `collateralName`, stimulates, and
awaits completion. If the stimulation fails, the processor rejects and the error propagates
so **BullMQ applies its retry/backoff** — and, with `resume`, the retry picks up the frontier.

```ts setup
import { Worker } from 'bullmq';
import { createCNSWorker } from '@cnstra/bullmq';
import { CNS, cnsAfferentPath, cnsCollateral, cnsModality } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSHandlerContext, TCNSNeuron } from '@cnstra/types';

declare const registry: CNSPersistOptionsRegistry;
declare const cns: CNS<TCNSNeuron>;
declare const ctx: TCNSHandlerContext;

const connection = { host: '127.0.0.1', port: 6379 };
const importUser = cnsCollateral<{ userId: string }>();
const createDeck = cnsCollateral<{ title: string }>();
const payload = { title: 'Welcome deck' };
const onboarding = cnsAfferentPath();
const flow = cnsModality({ onboarding });
```

## Producer

```ts
import { Queue } from 'bullmq';
import { enqueueCNSStimulation, cnsStimulationJob } from '@cnstra/bullmq';

const queue = new Queue('cns', { connection });

// cnsStimulationJob resolves the entry collateral to its registered NAME (portable on the queue)
const job = cnsStimulationJob(registry, importUser, { userId: '42' });
await enqueueCNSStimulation(queue, job, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
```

A job can run on an afferent path. Register the modality (`registry.registerModality('flow', flow)`) and pass it, or enqueue from a neuron body with `from: ctx` to keep the path of the run that enqueues it:

```ts
import { cnsStimulationJob } from '@cnstra/bullmq';

cnsStimulationJob(registry, createDeck, payload, { modality: flow, afferentPath: onboarding });
cnsStimulationJob(registry, createDeck, payload, { from: ctx });
```

The job carries the names (`modalityName`, `afferentPathName`); the worker starts the stimulation on that path, and a retry resumes on it.

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

  createCNSWorker({
    Worker, cns, registry, queue: 'cns', workerOptions: { connection },
    resume: { repository: new CNSRedisProgressRepository({ connection }) },
  });
  ```

Only the unfinished branch re-runs (`cns.activate(...)`), with its context. See
[Resumable execution](/docs/advanced/resumable-execution) for how `resume` (frontier) relates to
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

createCNSWorker({ Worker, cns, registry, queue: 'cns', workerOptions: { connection }, observe: history });

const runs = await history.listStimulations(); // roster for an admin screen
```

> ⚠️ Bound the in-memory store (`maxStimulations` / `ttlMs` / `deleteOnComplete`) or it will
> OOM a long-running worker — see
> [Resumable execution → bounds](/docs/advanced/resumable-execution#bound-in-memory). To keep the
> history across restarts, use `CNSPostgresStimulationRepository`. The DevTools panel renders
> this model directly — see [Stimulations](/docs/devtools/stimulations).

**See it live in the Explorer.** Hand that same `history` store to `startCNSDevTools` and every job the
worker processes shows up in the 🔎 Explorer — filterable by job type (entry collateral) or neuron,
each run drilling into its attempt/task waterfall. One shared store, no bespoke UI:

```ts
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import { startCNSDevTools } from '@cnstra/devtools-server';

const history = new CNSInMemoryStimulationRepository({ maxStimulations: 1000 });

await startCNSDevTools(cns, registry, { stimulationRepository: history });
createCNSWorker({ Worker, cns, registry, queue: 'cns', workerOptions: { connection }, observe: history });
// → open the printed URL → 🔎 Explorer. Separate process? Point both at one Postgres store instead.
```

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
stops taking new jobs, lets in-flight stimulations finish, then **aborts** any still running —
their remaining tasks become the frontier, the resume checkpoint records it, and the job's retry
resumes exactly there — and closes the worker. It does **not** close your `observe`/`resume`
stores (you own those).

`drainMs` (default 10s) is the budget for the whole shutdown, and it is a real bound: half goes
to finishing on their own, half to writing the checkpoints of whatever had to be aborted. It is
split rather than extended because the deadline that matters is on the shutdown as a whole — a
container's termination grace period — and a shutdown that overruns it is killed mid-write,
losing the checkpoint the drain existed to produce. A stimulation whose neuron ignores the abort
signal (an HTTP call with no signal wired through, say) therefore costs you the second half and
nothing more; it cannot hold the process open.

```ts
const { worker, shutdown } = createCNSWorker({ Worker, cns, registry, queue: 'cns', workerOptions: { connection }, resume: {} });
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
