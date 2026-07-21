# @cnstra/pg-boss

> **⚠️ Experimental**: API may change in future versions.

[pg-boss](https://github.com/timgit/pg-boss) (Postgres-backed job queue) integration for
[CNStra](https://cnstra.org). Run each stimulation as a durable job, get Postgres-native
retry/backoff/scheduling/singleton, and stream **per-hop progress** into any store for a
live admin/history view.

It follows the same pattern as the [Message Brokers guide](https://cnstra.org/docs/integrations/message-brokers):
**one job = one stimulation**, reconstructed across processes by **name** via a
`CNSPersistOptionsRegistry` (neuron/collateral object references are not portable).

## Install

```bash
npm install @cnstra/pg-boss @cnstra/core pg-boss
```

## Worker

```ts
import PgBoss from 'pg-boss';
import { createCNS } from '@cnstra/core';
import { createCNSWorker } from '@cnstra/pg-boss';

const { cns, registry } = createCNS({ importUserNeuron, /* … */ });

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue('cns');

await createCNSWorker({
  boss,
  cns,
  registry,
  queue: 'cns',
  // Optional: durably record every step. If onHop returns a Promise, CNStra
  // waits for it before running the next hop (per-hop checkpoint barrier).
  progress: {
    onStarted: (s) => db.insertStimulation(s),
    onHop:     (h) => db.insertHop(h),   // unique(stimulation_id, index) → idempotent
    onCompleted: (s) => db.finishStimulation(s),
  },
});
```

The worker reconstructs the entry signal from the job's `collateralName`, stimulates, and
awaits completion. If the stimulation fails or aborts, `waitUntilComplete()` rejects and the
error propagates so **pg-boss applies its retry/backoff policy**.

## Producer

```ts
import { enqueueStimulation, stimulationJob } from '@cnstra/pg-boss';

// Type-safe: throws if the collateral isn't registered
const job = stimulationJob(registry, importUser, { userId: '42' });

await enqueueStimulation(boss, 'cns', job, {
  retryLimit: 5,
  retryBackoff: true,
  singletonKey: 'user:42', // one in-flight stimulation per entity
});
```

## Retries & resume

- **Cross-process (recommended):** a retried job re-runs the whole flow from the entry signal.
  Make neurons **idempotent**, or deduplicate hops with `unique(stimulation_id, index)`.
- **In-process partial resume:** `cns.activate(getFailedTasks())` works only within one process
  (it holds live object references) — it is not portable through the queue.

## What this package does / doesn't

- ✅ Job execution, retry/backoff, scheduling, singleton, concurrency → **pg-boss**.
- ✅ Per-step (hop) progress records → the `progress` sink (your tables / OIMDB / logs).
- ❌ No built-in Postgres schema or admin UI — you own the store. pg-boss has **no per-step
  progress** of its own, so step history is always your tables. See the docs for a schema and
  an admin-panel design.

See the full guide: https://cnstra.org/docs/integrations/pg-boss

## License

MIT
