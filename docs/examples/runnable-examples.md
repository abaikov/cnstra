---
id: runnable-examples
title: Runnable Examples
sidebar_label: Runnable Examples
slug: /examples/runnable
---

The [`@cnstra/examples`](https://github.com/abaikov/cnstra/tree/master/packages/examples)
package holds small, **runnable** demos. Every command below runs straight from the
repo root — no build step, they execute the TypeScript with `tsx`.

```bash
git clone https://github.com/abaikov/cnstra
cd cnstra
npm install
```

## Durable execution & resume — no infra

A run fails partway, then **resumes from the exact frontier** (not from scratch) on
a second attempt; the whole run/attempt/task history is kept in a repository.

```bash
npm run demo:durable
```

No Postgres/Redis needed. Output: attempt #1 runs `importUser → enrichUser →
persistUser` where `persistUser` throws; "Retry" resumes **only** `persistUser`
(context intact) and the run completes.

## Retry admin — in a browser, one command

Boots a tiny server and serves the **CNStra retry admin** — Launch a task, watch it
**FAIL**, then **Retry** (resume the failed frontier) or **Clone** (fresh run from the
entry). Live, in the CNStra "Rotting Flesh" pixel theme.

```bash
npm run demo:admin            # in-process, no infra → http://localhost:4545
```

### Over a real broker — our admin instead of the broker's dashboard

The same admin can drive **Launch / Retry / Clone** through a real queue while keeping
the rich run/attempt/task store the UI renders — the CNStra admin *operating* the
broker, in place of its own (or nonexistent) UI.

```bash
# pg-boss (Postgres)
npm run demo:pg:up      # docker compose up postgres (or point DATABASE_URL at an existing one)
npm run demo:admin:pgboss

# BullMQ (Redis)
npm run demo:redis:up
npm run demo:admin:bull
```

Connection defaults: `DATABASE_URL=postgres://cnstra:cnstra@localhost:5432/cnstra`,
`REDIS_HOST=127.0.0.1` / `REDIS_PORT=6379` — override to target an existing instance.

### Durable history — survives a restart

```bash
npm run demo:admin:pg-store    # ADMIN_STORE=postgres
```

Backs the run/attempt/task **history** (the roster / attempt timeline / task waterfall) with
`@cnstra/persist-postgres` instead of memory. Kill and restart the server:
the runs are still there (read from Postgres), and Retry still resumes from the persisted
frontier. Note the **two independent stores**: the resume *checkpoint* (frontier, domain #1)
and the run *history* (domain #2) — each can be in-memory or persistent, chosen separately.

### Graceful shutdown & checkpoints

`Ctrl+C` (SIGINT/SIGTERM) shuts the demo down **cleanly, in order** — no separate
stop command:

1. **Abort in-flight.** The admin passes an `AbortSignal` into every
   `cns.stimulate(...)` / `cns.activate(...)`. On shutdown it aborts: the neuron
   mid-flight finishes, and the remaining queued tasks are marked aborted — that
   set **is the run's frontier**.
2. **Checkpoint.** The persistor writes that frontier as the run's progress
   (`getOutstandingTasks()` by name), so the run is left in a **resumable** state —
   a later "Retry" resumes exactly there via `cns.activate(frontier)`.
3. **Close the broker** connection (`worker.close()` / `boss.stop()`) — *after* the
   checkpoint, so the queue/DB is still reachable while the frontier is written.
4. The one-button `demo:admin:pgboss` / `demo:admin:bull` then run
   `docker compose down` on the container they started.

Note two different stores here. The **admin's** run/attempt/task history (what the UI
lists) is in-memory in this demo, so that view is per-process. The **resume
checkpoint** — the outstanding frontier a Retry needs — is a separate, durable thing:
the queue-worker demos below write it where the broker keeps it (BullMQ job progress /
a pg-boss Postgres table), so it survives a worker restart. Backing the admin's history
store the same way is the remaining step to make the whole UI survive a restart.

## Queue workers — the constructor matrix

The worker side on its own, without the admin UI. Durable resume is a **flexible
constructor**: any broker × any resume-checkpoint store × resume-on/off. The checkpoint
(the outstanding frontier) is an `ICNSProgressRepository` chosen **independently of the
broker**:

| demo | broker | checkpoint store | on retry |
|---|---|---|---|
| `demo:bull` | BullMQ | native job progress (built in) | resume frontier |
| `demo:bull:redis` | BullMQ | `@cnstra/progress-redis` (explicit) | resume frontier |
| `demo:pgboss` | pg-boss | in-package Postgres table `cns_pgboss_progress` | resume frontier |
| `demo:pgboss:redis` | pg-boss | `@cnstra/progress-redis` | resume frontier |
| `demo:pgboss:noprogress` | pg-boss | none (thin) | re-run whole flow from entry |

- **BullMQ** keeps jobs in Redis keyed by job id, so `@cnstra/bullmq` writes the frontier
  straight into the job's native progress (`job.updateProgress` / `job.progress`) by
  default — `resume: {}`, nothing to wire. Pass a `repository` to store it elsewhere.
- **pg-boss** has no mutable native progress field, so a checkpoint needs a store:
  the opt-in `@cnstra/pg-boss/postgres-progress` (table `cns_pgboss_progress`, keyed by
  job id, owns its migrations — `cnstra-pgboss-progress migrate`), or `@cnstra/progress-redis`,
  or omit `resume` for plain re-run-from-entry.
- **`@cnstra/progress-redis`** is broker-agnostic — the same Redis store works under either.

All are the one `ICNSProgressRepository` seam (in-memory only for tests); the persistent
options make the checkpoint survive a worker restart.

See the [Message Brokers](/docs/integrations/message-brokers) and
[pg-boss](/docs/integrations/pg-boss) guides for how the worker and resume wiring work.
