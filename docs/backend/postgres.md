---
id: backend-postgres
title: CNStra on Postgres — Jobs, Resume and Run History
sidebar_label: Postgres
slug: /backend/postgres
description: The Postgres packages of CNStra and what each one keeps — a job queue with resume on your own database, a resume checkpoint for pg-boss, and the run history the DevTools retry admin reads.
keywords: [postgres, job queue, resumable execution, resume, checkpoint, run history, pg-boss, SKIP LOCKED, CNStra]
---

A run of CNStra keeps two things you may want in Postgres: its **frontier** — the signals still to be handled, which is all a retried run needs to go on where it stopped — and its **history** — the run, its attempts and the task of every hop, which the DevTools retry admin shows. The graph itself is never stored: the code is its source of truth. Three packages keep these in Postgres, each for a different job.

| package | what it keeps | when to use it |
|---|---|---|
| `@cnstra/jobs-postgres` with `@cnstra/jobs` and `@cnstra/jobs-adapter` | a whole job queue: jobs, their frontier while they run, history, a journal, schedules, throttles | you want a queue on the Postgres you already have, with resume, and no other service |
| `@cnstra/pg-boss` with its `@cnstra/pg-boss/postgres-progress` store | the frontier only, one row per job; the queue is pg-boss | you already run pg-boss |
| `@cnstra/persist-postgres` | the run history: stimulation → attempt → task, and the last frontier of each run | you want runs to survive a restart in the retry admin, next to either queue above |

## A job queue on your Postgres: `@cnstra/jobs-postgres`

```sh
npm install @cnstra/jobs @cnstra/jobs-postgres @cnstra/jobs-adapter pg
```

`@cnstra/jobs` is the queue: job types, workers, retries, cancel, schedules, group throttles. `@cnstra/jobs-postgres` is its repository on Postgres — the `cns_job` table holds the live jobs, `cns_job_history` (partitioned by finish time) the finished ones, `cns_job_log` the journal and `cns_job_schedule` the schedules. Workers claim jobs with `FOR UPDATE SKIP LOCKED` under a lease that a dead worker's job is taken over from, and wake up on `LISTEN`/`NOTIFY` instead of only polling. A job can be enqueued in the same transaction as your own writes, through pg, postgres.js, Prisma, Drizzle, Kysely, Knex, TypeORM, MikroORM or Sequelize.

`@cnstra/jobs-adapter` runs a job type as a CNStra stimulation: the job type is an entry collateral, one job is one stimulation, and the frontier is saved into the job's own `state` while it runs. A retried job resumes from there; a save from an attempt that is no longer the live one is ignored.

## pg-boss with a Postgres checkpoint

```sh
npm install @cnstra/pg-boss @cnstra/core pg-boss pg
```

pg-boss keeps the queue in its own schema; `@cnstra/pg-boss/postgres-progress` adds one table, `cns_pgboss_progress`, with the frontier of each running job, deleted when the job succeeds. See [pg-boss](../integrations/pg-boss.md) for the worker and the retention of failed rows.

## Run history: `@cnstra/persist-postgres`

```sh
npm install @cnstra/persist-postgres pg
```

The run roster, the attempt timeline and the task waterfall of the retry admin, in `cns_stimulation`, `cns_stimulation_attempt` and `cns_stimulation_task` (partitioned by start time). Pass it as `observe` to either queue above. Every checkpoint also writes the frontier into `cns_stimulation.progress`, which is what Retry in the DevTools sends back to the app; it does not run anything by itself — it is a history, not a queue. See [Resumable execution](../advanced/resumable-execution.md).

## Migrations

Each package migrates its own tables with numbered steps, in one transaction under an advisory lock, so every process can migrate at startup. A first install refuses to run over tables with the same prefix that it did not create. A step that removes something runs only with `{ contract: true }`, and `verify` writes nothing and fails when a step this release needs is missing. `@cnstra/persist-postgres` ships a `cnstra-persist-postgres migrate` command and `@cnstra/pg-boss` a `cnstra-pgboss-progress` command; for `@cnstra/jobs-postgres` call `CNSPostgresJobSchema.migrate(database, tablePrefix)`.
