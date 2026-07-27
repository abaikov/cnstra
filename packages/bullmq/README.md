# @cnstra/bullmq

> **⚠️ Experimental**: API may change in future versions.

[BullMQ](https://docs.bullmq.io) (Redis-backed job queue) integration for
[CNStra](https://cnstra.org). Run each stimulation as a durable job, get BullMQ-native
retry/backoff/scheduling/concurrency, and — with `resume` — have a **retried job continue
the failed frontier** instead of re-running from the entry signal.

It follows the same pattern as the [Message Brokers guide](https://cnstra.org/docs/integrations/message-brokers)
and the sibling [`@cnstra/pg-boss`](../pg-boss): **one job = one stimulation**, reconstructed
across processes by **name** via a `CNSPersistOptionsRegistry` (neuron/collateral object
references are not portable).

## Install

```bash
npm install @cnstra/bullmq @cnstra/core @cnstra/persist bullmq
```

## Worker

```ts
import { Worker } from 'bullmq';
import { createCNSWorker } from '@cnstra/bullmq';

const connection = { host: '127.0.0.1', port: 6379 };

const worker = createCNSWorker({
  Worker,                       // pass the BullMQ Worker class
  cns,
  registry,
  queue: 'cns',
  connection,
  // Durable RESUME: a retried job (BullMQ reuses the same job id) continues the
  // outstanding frontier via cns.activate(...) — the failed neuron re-runs with
  // its context, the rest does not. With no `repository`, the checkpoint lives in
  // BullMQ's OWN per-job progress (job.updateProgress / job.progress, in Redis) —
  // no side store. Pass a repository only to store it elsewhere.
  resume: {},
  // Optional per-hop progress sink; if onHop returns a Promise, CNStra waits
  // for it before running the next hop (per-hop checkpoint barrier).
  progress: {
    onStarted:   (s) => db.insertStimulation(s),
    onHop:       (h) => db.insertHop(h),
    onCompleted: (s) => db.finishStimulation(s),
  },
});
// worker.close() to shut down.
```

The worker reconstructs the entry signal from the job's `collateralName`, stimulates, and
awaits completion. If the stimulation fails, the processor rejects and the error propagates so
**BullMQ applies its retry/backoff policy** — and, with `resume`, the retry picks up the frontier.

## Producer

```ts
import { Queue } from 'bullmq';
import { enqueueStimulation, stimulationJob } from '@cnstra/bullmq';

const queue = new Queue('cns', { connection });

// Type-safe: throws if the collateral isn't registered
const job = stimulationJob(registry, importUser, { userId: '42' });

await enqueueStimulation(queue, job, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  jobId: 'user:42', // one in-flight stimulation per entity (dedupe)
});
```

## Retries & resume

- **With `resume` (recommended):** BullMQ retries reuse the **same job id**, so the worker loads
  the persisted frontier and continues via `cns.activate(...)` — only the unfinished branch
  re-runs, with its context. On success the checkpoint is dropped; on final failure it is
  kept for the next retry. By default (no `repository`) the checkpoint is BullMQ's **own job
  progress** — nothing to provision. Neurons should still be **idempotent** (resume narrows
  re-execution, it does not make individual hops exactly-once).
- **Without `resume`:** a retried job re-runs the whole flow from the entry signal.

## What this package does / doesn't

- ✅ Job execution, retry/backoff, scheduling, concurrency → **BullMQ**.
- ✅ Durable frontier resume across retries → BullMQ's own job progress by default, or a
  `resume.repository` you supply.
- ✅ Per-step (hop) progress records → the `progress` sink (your store / OIMDB / logs).
- ❌ No built-in Redis schema or admin UI — you own the store. See `@cnstra/examples`
  (`demo:bull`, `demo:admin`) for a runnable worker and the CNStra retry admin.

See the sibling guide: https://cnstra.org/docs/integrations/message-brokers

## License

MIT
