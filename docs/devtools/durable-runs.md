---
id: durable-runs
title: Durable Runs — retry & clone in the panel
sidebar_label: Durable Runs
slug: /devtools/durable-runs
description: The DevTools name-based Stimulation → Attempt → Task view, retry (resume frontier) and clone (fresh run) actions, and how to persist the store so the panel becomes a restart-surviving admin.
keywords: [devtools, durable runs, retry, clone, trackStimulations, stimulations, attempts, tasks, admin panel]
---

The DevTools render the same [durable-execution model](../advanced/durable-execution.md) —
**Stimulation → Attempt → Task** — with two views:

- **⚡ Stimulations** — the live run/attempt/task stream from the app, by name.
- **💀 Durable Runs** — a retry admin: a run roster with **Retry** and **Clone** actions.

## App side — emit the model

The producer emits the name-based model by default; `trackStimulations` is on unless you
turn it off.

```ts
import { CNSDevTools } from '@cnstra/devtools';

const devtools = new CNSDevTools('my-app', transport, {
  cnsId: 'my-app:core',      // becomes the run's scopeName
  // trackStimulations: true  // default; set false to disable stimulation tracking
});
devtools.registerCNS(cns, registry);
```

Every stimulation on that CNS is streamed as Stimulation/Attempt/Task (the producer runs a
`CNSStimulationPersistor` per run — the same recorder the queue workers use).

## Server side — where the runs are stored

`CNSDevToolsServer` takes the app/topology repository as its first argument and the
**name-based run store** (`ICNSStimulationRepository`) as its second:

```ts
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';

const runStore = new CNSPostgresStimulationRepository({ connectionString: DATABASE_URL });
const server = new CNSDevToolsServer(appTopologyRepo, runStore);
```

Default (omit the 2nd arg) is an in-memory store — great for dev, but
[bound it](../advanced/durable-execution.md#bound-in-memory) for
anything long-running. With a Postgres store the panel survives restarts and becomes a real
admin.

## Retry & clone

From the **💀 Durable Runs** panel:

- **Retry** — enabled on a failed run; resumes its outstanding **frontier** as a new
  attempt (only the unfinished branch re-runs, with its context). Over the wire the server
  reads the stored `progress`, mints attempt *n+1*, and forwards a resume command to the
  owning app, which hydrates and runs `cns.activate(...)`.
- **Clone** — a fresh run from the original **entry** (a clean re-do), new id, attempt 1.

The client behind the panel is a pluggable seam (`ICNSDurableRunsClient`) — it polls over
HTTP (the standalone admin) or over the DevTools WebSocket; the same page renders either.

## One-button example

`@cnstra/examples` wires all of this over a real broker + the actual panel:

```bash
npm run demo:panel:bull      # BullMQ (Redis) + the DevTools panel on :8080
npm run demo:panel:pgboss    # pg-boss (Postgres) + the panel
```

Open `http://localhost:8080` → **💀 Durable Runs** shows the broker-backed runs (Launch a
run, watch it fail, **Retry** to resume the frontier, **Clone** for a fresh run), while
**⚡ Stimulations** shows the app's own CNS activity live. See
[runnable examples](../examples/runnable-examples.md).

## See also

- [Durable execution](../advanced/durable-execution.md) — the model, `observe` vs `resume`, stores & bounds.
- [Log correlation](../recipes/log-correlation.md) — tie your logs to the same run ids the panel shows.
