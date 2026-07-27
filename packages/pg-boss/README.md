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
  // Optional: record the name-based Stimulation → Attempt → Task history (the SAME
  // model the DevTools use) into any ICNSStimulationRepository. In-memory just to
  // *see* it; Postgres to keep it. One job = one stimulation; each retry = an attempt.
  // observe: new CNSInMemoryStimulationRepository(),
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

pg-boss reuses the **same job id** across a job's retries, so with `resume` the worker loads the
outstanding frontier and continues via `cns.activate(...)` — only the failed branch re-runs, with
its context. In pg-boss a run = stimulation = job, so the checkpoint is keyed by **job id**.

The checkpoint store is **pluggable** — three ways:

```ts
// 1) In-package Postgres table (cns_pgboss_progress) — opt-in subpath, pulls in `pg`
import { CNSPgBossProgressRepository } from '@cnstra/pg-boss/postgres-progress';
resume: { repository: new CNSPgBossProgressRepository({ connectionString: DATABASE_URL }) }

// 2) Redis, or any other ICNSProgressRepository — the store is independent of the broker
import { CNSRedisProgressRepository } from '@cnstra/progress-redis';
resume: { repository: new CNSRedisProgressRepository({ connection }) }

// 3) No resume at all → thin mode: a retried job re-runs the WHOLE flow from the entry signal.
//    (omit `resume`) — make neurons idempotent.
```

pg-boss's `Job` has no mutable native progress field (unlike BullMQ), so a checkpoint needs a store.

**Migrations:** the Postgres table is owned by this package. Auto-created on first use, or manage it
yourself: `DATABASE_URL=… npx cnstra-pgboss-progress migrate` (or call `ensureSchema(pool)` from
`@cnstra/pg-boss/postgres-progress`).

**Row lifecycle / cleanup:** one upserted row per `job.id`. The worker **deletes it when the job
succeeds**. A job that fails *permanently* (retries exhausted) keeps its row — pg-boss has no
terminal-failure hook to key off — so prune those periodically by staleness (a still-retrying job
keeps `updated_at` fresh, so pick a threshold well above your longest retry window):

```ts
const store = new CNSPgBossProgressRepository({ connectionString: DATABASE_URL });
// e.g. in a daily cron: drop checkpoints untouched for over a day
await store.deleteStale(24 * 60 * 60 * 1000);
```

## What this package does / doesn't

- ✅ Job execution, retry/backoff, scheduling, singleton, concurrency → **pg-boss**.
- ✅ Durable frontier **resume** across retries → a pluggable `resume.repository` (in-package
  Postgres, `@cnstra/progress-redis`, or your own); omit it for plain re-run-from-entry.
- ✅ Name-based run/attempt/task **observability** → an optional `observe` store (in-memory to
  just see it, Postgres to keep it — the same model the DevTools render).
- ❌ No built-in admin UI — see `@cnstra/examples` (`demo:admin`) for the CNStra retry admin.

See the full guide: https://cnstra.org/docs/integrations/pg-boss

## License

MIT
