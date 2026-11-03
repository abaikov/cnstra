# @cnstra/examples

Runnable CNStra examples. Home for demos — start with resumable execution / resume.

## 0. Retry admin — the whole thing in a browser (`npm run demo:admin`) ⭐

One command, no infra. Boots a tiny server (Node `http`, zero deps) fronting the
resumable-execution engine and serves the **CNStra retry admin** — our admin, in
place of pg-boss/Bull's:

```bash
cd packages/examples
npm run demo:admin           # in-process (no infra)   → http://localhost:4545
npm run demo:admin:pgboss    # over a real pg-boss / Postgres queue
npm run demo:admin:bull      # over a real BullMQ / Redis queue
npm run demo:admin:pg-store  # run/attempt/task history in Postgres — survives a restart
```

The two broker examples run **Launch / Retry / Clone** through a real pg-boss (Postgres)
or BullMQ (Redis) queue — replacing the broker's own dashboard — while keeping the rich
run/attempt/task store the UI renders. Bring the broker up first (`npm run pg:up` / `npm
run redis:up`, or point `DATABASE_URL` / `REDIS_HOST`+`REDIS_PORT` at an existing one).

`demo:admin:pg-store` (`ADMIN_STORE=postgres`) backs the run/attempt/task **history** with
[`@cnstra/persist-postgres`](../persist-postgres): kill and restart the server and the run
roster, attempt timeline and task waterfall are all still there — and Retry still resumes
from the persisted frontier. (Two independent stores: the checkpoint that resume needs, and
this run history — either can be in-memory or persistent.)

**Launch** a task, watch the run **FAIL** partway (the run roster shows it red, the
task waterfall shows `importUser ✓ → enrichUser ✓ → persistUser ✗` with the
error), then:
- **Retry (resume frontier)** — attempt #2 re-runs **only** `persistUser` (context
  intact) and the run turns green;
- **Clone (fresh run from entry)** — a brand-new run from the same input.

Live updates stream over SSE. With `ADMIN_QUEUE=bull`, every action flows through a real
Redis queue (`npm run redis:up` first) while the rich run/attempt/task store the
UI renders stays in the admin — the CNStra admin *operating* a real broker.

Endpoints (all curl-able): `GET /api/runs`, `GET /api/info`, `POST /api/launch {fail}`,
`POST /api/retry {runId}`, `POST /api/clone {runId}`, `GET /api/events` (SSE).

## 1. Resumable execution & resume — no infra (`npm run demo:resume`)

The resumable-execution **engine** in-process: a run fails partway, then **resumes
from the exact frontier** (not from scratch) on a second attempt. The whole
run/attempt/task history is kept in a repository — the same data the DevTools
"resumable runs" admin renders. Prints an ASCII "admin view" of the run.

```bash
cd packages/examples
npm run demo:resume
```

No Postgres/Redis needed. Shows: attempt #1 runs `importUser → enrichUser →
persistUser` where `persistUser` throws; "Retry" resumes **only** `persistUser`
(context intact) and the run completes.

## 2. Resumable via pg-boss (Postgres) — `npm run demo:pgboss`

Same flow delivered through **pg-boss** (one job = one run). The job fails, pg-boss
retries the **same** job, and the CNStra worker **resumes the outstanding frontier**
instead of re-running from the entry signal.

```bash
cd packages/examples
npm run pg:up          # Postgres via docker compose
npm run demo:pgboss
npm run pg:down        # tear down
```

`DATABASE_URL` defaults to `postgres://cnstra:cnstra@localhost:5432/cnstra`.

## 3. Resumable via BullMQ (Redis) — `npm run demo:bull`

Same flow delivered through **BullMQ** (one job = one run). The job fails, BullMQ
retries the **same job id**, and the CNStra worker **resumes the outstanding
frontier** instead of re-running from the entry signal.

```bash
cd packages/examples
npm run redis:up          # Redis via docker compose
npm run demo:bull
npm run redis:down        # tear down
```

Connection defaults to `REDIS_HOST=127.0.0.1` / `REDIS_PORT=6379`. Output shows
`importUser` runs once, `persistUser` throws on attempt #1, then the retry resumes
**only** `persistUser` (context `tries` 1 → 2) and the run completes.

## The constructor matrix — broker × progress store

Resumable resume is a **flexible constructor**: any broker × any resume-checkpoint store ×
resume-on/off. The checkpoint (the outstanding frontier) is an `ICNSProgressRepository`,
chosen independently of the queue:

| demo | broker | checkpoint store | on retry |
|---|---|---|---|
| `npm run demo:bull` | BullMQ | BullMQ's **native job progress** (built in) | resume frontier |
| `npm run demo:bull:redis` | BullMQ | **`@cnstra/progress-redis`** (explicit) | resume frontier |
| `npm run demo:pgboss` | pg-boss | **in-package Postgres table** `cns_pgboss_progress` | resume frontier |
| `npm run demo:pgboss:redis` | pg-boss | **`@cnstra/progress-redis`** | resume frontier |
| `npm run demo:pgboss:noprogress` | pg-boss | **none** (thin) | re-run whole flow from entry |

Where the store lives:
- **`@cnstra/bullmq`** — default is the job's own native progress (`job.updateProgress`); swap in
  any repository via `resume.repository`.
- **`@cnstra/pg-boss/postgres-progress`** — opt-in Postgres table + migrations
  (`cnstra-pgboss-progress migrate`); the main `@cnstra/pg-boss` import stays `pg`-free.
- **`@cnstra/progress-redis`** — broker-agnostic Redis KV, usable with either broker.
- **in-memory** (`@cnstra/persist`) — tests/dev.

All brokers mirror the same contract: one job = one stimulation, reconstructed by name via a
`CNSPersistOptionsRegistry`. Run any of the above from the repo root too (`npm run demo:…`).
