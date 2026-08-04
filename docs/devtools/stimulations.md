---
id: stimulations
title: Stimulations (Explorer)
sidebar_label: Stimulations
slug: /devtools/stimulations
description: The DevTools Explorer — the single stimulation surface. A faceted roster of Stimulation → Attempt → Task runs with search, charts, an activation map, a per-run waterfall, and retry (resume frontier) / clone (fresh run) actions.
keywords: [devtools, explorer, stimulations, attempts, tasks, retry, clone, resume, facets, waterfall, trackStimulations]
---

The DevTools render the name-based [resumable-execution model](../advanced/resumable-execution.md)
— **Stimulation → Attempt → Task** — in one place: the **🔎 Explorer**. It is the single
stimulation surface (there is no separate "runs" screen — it is all just stimulations):

- **Roster** — every run, newest-first, filterable by status, entry collateral (job type) or
  neuron; keyset-paginated so it stays usable at 20k+ runs.
- **Facets · Chart · Map** — counts by job type / neuron, a throughput histogram (optionally
  summing a payload metric), and a proportional activation heat-map.
- **Waterfall** — a selected run's attempts, each neuron-by-neuron task with its in/out
  collaterals and errors — plus **Retry** and **Clone**.

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
[bound it](../advanced/resumable-execution.md#bound-in-memory) for anything long-running. With
a Postgres store the panel survives restarts and becomes a real admin.

> **Same store as your worker.** Hand that exact `runStore` to a pg-boss / BullMQ worker's
> `observe` and every queue job shows up in the Explorer live — see
> [pg-boss](../integrations/pg-boss.md) / [BullMQ](../integrations/bullmq.md).

## Retry & clone

Select a run to open its waterfall; the two actions are on the header:

- **Retry** — resumes the run's outstanding **frontier** as a new attempt (only the unfinished
  branch re-runs, with its context). Over the wire the server reads the stored `progress`,
  mints attempt *n+1*, and forwards a resume command to the owning app, which hydrates and runs
  `cns.activate(...)`. Rejected if the run has no frontier (nothing to resume).
- **Clone** — a fresh run from the original **entry** (a clean re-do), new id, attempt 1.

## One-button example

`@cnstra/examples` wires all of this over a real broker + the actual panel:

```bash
npm run demo:panel:bull      # BullMQ (Redis) + the DevTools panel on :8080
npm run demo:panel:pgboss    # pg-boss (Postgres) + the panel
```

Open `http://localhost:8080` → **🔎 Explorer** shows the broker-backed runs (watch one fail,
**Retry** to resume the frontier, **Clone** for a fresh run). See
[runnable examples](../examples/runnable-examples.md).

## See also

- [Resumable execution](../advanced/resumable-execution.md) — the model, `observe` vs `resume`, stores & bounds.
- [Log correlation](../recipes/log-correlation.md) — tie your logs to the same run ids the panel shows.
