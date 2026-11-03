# @cnstra/bullmq

> **⚠️ Experimental**: API may change in future versions.

[BullMQ](https://docs.bullmq.io) (Redis-backed job queue) integration for
[CNStra](https://cnstra.org). Run each stimulation as a resumable job, get BullMQ-native
retry/backoff/scheduling/concurrency, and — with `resume` — have a **retried job continue
the failed frontier** instead of re-running from the entry signal.

It follows the same pattern as the [BullMQ guide](https://cnstra.org/docs/integrations/bullmq)
and the sibling [`@cnstra/pg-boss`](../pg-boss): **one job = one stimulation**, reconstructed
across processes by **name** via a `CNSPersistOptionsRegistry` (neuron/collateral object
references are not portable).

## Install

```bash
npm install @cnstra/bullmq @cnstra/core @cnstra/persist bullmq
```

## Worker

```ts setup
import type { CNS, CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSNeuron } from '@cnstra/types';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
declare const importUser: CNSCollateral<{ userId: string }>;
```

```ts
import { Worker } from 'bullmq';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import { createCNSWorker } from '@cnstra/bullmq';

const connection = { host: '127.0.0.1', port: 6379 };

const worker = createCNSWorker({
  Worker,                       // pass the BullMQ Worker class
  cns,
  registry,
  queue: 'cns',
  workerOptions: { connection },
  // Resumable RESUME: a retried job (BullMQ reuses the same job id) continues the
  // outstanding frontier via cns.activate(...) — the failed neuron re-runs with
  // its context, the rest does not. With no `repository`, the checkpoint lives in
  // BullMQ's OWN per-job progress (job.updateProgress / job.progress, in Redis) —
  // no side store. Pass a repository only to store it elsewhere.
  resume: {},
  // Optional history store: the name-based Stimulation → Attempt → Task model,
  // written per hop — the same model the DevTools render.
  observe: new CNSInMemoryStimulationRepository({ maxStimulations: 1000 }),
});
// worker.shutdown() to drain in-flight runs and close.
```

The worker reconstructs the entry signal from the job's `collateralName`, stimulates, and
awaits completion. If the stimulation fails, the processor rejects and the error propagates so
**BullMQ applies its retry/backoff policy** — and, with `resume`, the retry picks up the frontier.

## Producer

```ts
import { Queue } from 'bullmq';
import { enqueueCNSStimulation, cnsStimulationJob } from '@cnstra/bullmq';

const queue = new Queue('cns', { connection: { host: '127.0.0.1', port: 6379 } });

// Type-safe: throws if the collateral isn't registered
const job = cnsStimulationJob(registry, importUser, { userId: '42' });

await enqueueCNSStimulation(queue, job, {
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
- ✅ Resumable frontier resume across retries → BullMQ's own job progress by default, or a
  `resume.repository` you supply.
- ✅ Per-step (hop) history records → the `observe` store (`CNSInMemoryStimulationRepository`, or a Postgres store to keep it).
- ❌ No built-in Redis schema or admin UI — you own the store. See `@cnstra/examples`
  (`demo:bull`, `demo:admin`) for a runnable worker and the CNStra retry admin.

See the full guide: https://cnstra.org/docs/integrations/bullmq

## License

MIT
