# @cnstra/persist-postgres

> **⚠️ Experimental**: API may change.

A **Postgres relational store** for CNStra's resumable run/attempt/task model —
implements [`ICNSStimulationRepository`](../persist) (the run roster → attempt timeline →
task waterfall the retry admin renders). Makes the resumable-execution history **survive a
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
  connectionString: process.env.DATABASE_URL, // or { pool }; { queryable } needs autoMigrate: false
  tablePrefix: 'cns_',                          // default
  autoMigrate: true,                            // create or upgrade the tables on first use
});
```

It implements `ICNSStimulationRepository` and `ICNSStimulationRosterQuery`: the persistor writes
through `saveStimulation` / `saveAttempt` / `appendTask`, the retry UI reads through
`getStimulation` / `listStimulations` / `getAttempts` / `getTasks` / `queryRoster` / `queryFacets`,
and retention runs through `deleteStale(olderThanMs)`.

## Schema

Three tables under the prefix (default `cns_`, at most 32 characters):

```
cns_stimulation(stimulation_id PK, entry jsonb, status, scope_name, progress jsonb, updated_at,
                started_at, hop_count, last_completed_at)
cns_stimulation_attempt(stimulation_attempt_id PK, stimulation_id, attempt_number, status,
                        started_at, completed_at, hop_count, has_error, replay_of, entry jsonb,
                        UNIQUE(stimulation_id, attempt_number))
cns_stimulation_task(stimulation_attempt_id, task_index, neuron_name, dendrite_collateral_name,
                     input_index, output jsonb, status, error, started_at, duration_ms,
                     activation_context jsonb, PK(stimulation_attempt_id, task_index, started_at))
                     PARTITION BY RANGE (started_at), with cns_stimulation_task_default
```

Statuses are checked against the DTO enums. The roster is served by `stimulation(started_at DESC, stimulation_id)`
and, with a scope filter, `stimulation(scope_name, started_at DESC, stimulation_id)`. `updated_at` is not indexed
and the table keeps 30% of each page free, so the update every checkpoint makes can stay a HOT update;
`listStimulations` and `deleteStale` scan for it.

`cns_stimulation_task` holds a row per hop and is partitioned by day of `started_at`, so retention drops whole
partitions instead of deleting rows and leaves nothing for vacuum. With a `pool`, every `deleteStale(olderThanMs)`
deletes the stale runs row by row and then drops the days that ended before the window and attaches the next seven
days (named after the table and the UTC day, as cns_stimulation_task_p20261104), under an advisory lock so replicas take turns. Call it at least weekly:
tasks of days that have no partition yet go to `cns_stimulation_task_default`, which is cleaned only by row deletes.
Through a `queryable` no partitions are made and every task stays in the default partition.

A partition is attached only for days after today, because Postgres refuses a range the default partition already
has rows in. Attaching scans the default partition while holding it exclusively: reads of the whole task table and
tasks written into a day without a partition wait for that scan, once per attached day, so it costs as much as the
default partition is large (seven scans on the first call after install, one a day after that); the task table itself is locked only against other schema changes. Dropping runs in a transaction of its own
before attaching, so it locks the task table exclusively only for the drop itself. Either step gives up after 5 s of waiting for its lock: `deleteStale` then throws
after the row deletes are done, and the next call retries. Tasks are dropped by their own age, so a run still listed
whose tasks started before the window shows no tasks for those days (a retried old run loses its first attempt's
tasks; its resume does not need them, the frontier is in `progress`). Keep `olderThanMs` above the longest run.
A task redelivered as the same record is written once; an attempt id that runs a second time (a crashed worker's job
picked up again under the same attempt number) keeps the tasks of both runs.

Requires PostgreSQL 12 or later. Writes through a `queryable` run without a transaction, so the roster fields can
lag behind concurrent writes until the run's next checkpoint; pass a `pool` for exact ones. Tasks and attempts can be written before their parent row; `deleteStale(olderThanMs)`
also removes those older than the window whose parent never arrived, so keep `olderThanMs` well above the
persistor's flush interval.

`started_at`, `hop_count` and `last_completed_at` are the roster fields, recomputed from the run's attempts by
every `saveAttempt` and `saveStimulation` under a per-run advisory lock, so the roster reads one indexed table.

`progress` is the whole `TCNSProgress` a resume needs: the frontier, the run context, the
modality and every task's activation context. Times are milliseconds from the repository clock
(`now`, default `Date.now`).

## Migrations

The package owns its schema and records every applied step in `cns_stimulation_migration`.
Auto-applied on first use, or run it yourself:

```bash
DATABASE_URL=postgres://... npx cnstra-persist-postgres migrate
# CNS_TABLE_PREFIX=my_ to override the prefix
```

or call `CNSPostgresStimulationSchema.migrate(pool, prefix)`. It runs in one transaction under an
advisory lock, so replicas starting together wait for each other. A step that removes something
(`contract`) is applied only with `{ contract: true }`, after no process of the previous release
is left. In a running service call `CNSPostgresStimulationSchema.verify(pool, prefix)` instead: it
writes nothing and fails at startup when a step this release needs is missing.
`CNSPostgresStimulationSchema.migrationSql(prefix, appliedSteps)` hands the same SQL to your own
migration tool.

## License

MIT
