# @cnstra/persist-postgres

> **⚠️ Experimental**: API may change.

A **Postgres relational store** for CNStra's durable run/attempt/task model —
implements [`ICNSStimulationRepository`](../persist) (the run roster → attempt timeline →
task waterfall the retry admin renders). Makes the durable-execution history **survive a
process restart**, and a retried run resumes from the persisted frontier.

This is domain **#2** (run/attempt/task history), distinct from the resume **checkpoint**
progress store (domain #1 — `@cnstra/pg-boss/postgres-progress`, `@cnstra/progress-redis`).

## Install

```bash
npm install @cnstra/persist-postgres pg
```

## Use

```ts
import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';

const repo = new CNSPostgresStimulationRepository({
  connectionString: process.env.DATABASE_URL, // or { pool } / { queryable }
  tablePrefix: 'cns_',                          // default
  autoMigrate: true,                            // lazily create tables on first use
});

// Drives the persistor (write) and the retry UI (read):
//   saveRun / saveStimulation / appendTask ; getRun / listRuns / getStimulations / getTasks / delete
```

Reuses the `IPgQueryable` seam, so `pg` is an optional peer — inject any pg client/pool,
or pass a `connectionString` for the repo to own a Pool (`close()` ends it).

## Schema

Five tables under the prefix (default `cns_`). The run's `progress` is **normalised**: the
outstanding frontier into `cns_run_frontier` (one row per task) and per-neuron context into
`cns_run_context`, so you can query the frontier — rebuilt into `TCNSProgress` on read.

```
cns_run(stimulation_run_id PK, entry jsonb, status, created_at, updated_at)
cns_run_frontier(run_id → cns_run, ord, neuron_name, dendrite_collateral_name, input jsonb)
cns_run_context(run_id → cns_run, neuron_name, value jsonb)
cns_stimulation(stimulation_id PK, run_id → cns_run, attempt_number, status, started_at,
                completed_at, hop_count, has_error, replay_of, entry jsonb,
                UNIQUE(run_id, attempt_number))
cns_task(stimulation_id, index, neuron_name, dendrite_collateral_name, input_index,
         output jsonb, status, error, started_at, duration, PK(stimulation_id, index))
```

## Migrations

The package owns its schema. Auto-created on first use, or manage it yourself:

```bash
DATABASE_URL=postgres://... npx cnstra-persist-postgres migrate
# CNS_TABLE_PREFIX=my_ to override the prefix
```

or call `ensureSchema(pool, prefix)` from `@cnstra/persist-postgres`.

## License

MIT
