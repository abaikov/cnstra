---
id: stimulations
title: Stimulations (Explorer)
sidebar_label: Stimulations
slug: /devtools/stimulations
description: The DevTools Explorer — the single stimulation surface. A faceted roster of Stimulation → Attempt → Task runs with search, charts, an activation map, a per-run waterfall, and retry (resume frontier) / clone (fresh run) actions.
keywords: [devtools, explorer, stimulations, attempts, tasks, retry, clone, resume, facets, waterfall, trackStimulations]
---

The DevTools render the name-based [resumable-execution model](../advanced/resumable-execution.md)
— **Stimulation → Attempt → Task** — in one place: the Explorer.

- **Roster** — every run, newest-first, filterable by status, entry collateral (job type) or
  neuron; keyset-paginated so it stays usable at 20k+ runs.
- **Charts** — a status breakdown and a throughput histogram; `?metric=<path>` in the panel
  URL sums a payload field instead of counting runs.
- **Waterfall** — a selected run's attempts, each neuron-by-neuron task with its in/out
  collaterals and errors — plus **Retry** and **Clone**.

## App side — emit the model

The producer emits the name-based model by default; `trackStimulations` is on unless you
turn it off.

```ts setup
import type { CNS } from '@cnstra/core';
import type { TCNSNeuron } from '@cnstra/types';
import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import type { CNSPersistOptionsRegistry, ICNSStimulationRepository } from '@cnstra/persist';
import type { TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import type { ICNSDevToolsServerRepository } from '@cnstra/devtools-server';

declare const DATABASE_URL: string;
declare const transport: ICNSDevToolsTransport;
declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
declare const appTopologyRepo: ICNSDevToolsServerRepository;
declare const repository: ICNSDevToolsServerRepository;
declare const stimulationRepository: ICNSStimulationRepository;
declare const actions: TCNSDevToolsActionMiddleware[];
```

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
  branch re-runs; each task carries its own input signal, so nothing extra is restored). Over the
  wire the server reads the stored `progress`,
  mints attempt *n+1*, and forwards a resume command to the owning app, which hydrates and runs
  `cns.activate(...)`. Rejected if the run has no frontier (nothing to resume).
- **Clone** — a fresh run from the original **entry** (a clean re-do), new id, attempt 1.

### Which one to reach for

They are not two spellings of the same thing, and the difference is what happens to
the record you already have.

**Retry continues the same run.** Same `stimulationId`, one more attempt, and the
run's stored state is updated in place: its `progress` is replaced as the resumed
attempt advances, and its status moves with it. That is what you want when the run
*is* the thing — one job, one order, one id you quote in a ticket — and you simply
need the unfinished part to finish.

**Clone leaves the original alone.** New `stimulationId`, attempt 1, everything
re-runs from the entry signal. Reach for it when the record must not change: an
incident you are still reading, a run you want to compare against, or a fix that
landed in a neuron that already succeeded — Retry would skip that neuron, because
it is not in the frontier any more.

The rule of thumb: **if you would mind losing what the original run recorded, clone
it.**

### Turning one of them off

A server can decide which actions the panel offers, and the panel asks for that on
connect:

```typescript
new CNSDevToolsServer(repository, stimulationRepository, actions, {
    actions: { retry: false },   // this deployment never overwrites a run record
});
```

An action set to `false` is **not drawn** — a greyed-out button reads as "not right
now", which is the wrong story when the answer is "never here". An unset flag means
allowed, so a server that sends no config leaves both buttons exactly as they were.

Typical reasons to use it: a shared staging panel where re-running an order in place
would confuse whoever is reading the incident (turn Retry off), or a deployment
where run ids are business keys and a clone would create one that means nothing
(turn Clone off).

### How far back the panel looks

The Explorer opens on the **last five minutes**. Every screen in it is
time-ordered — the roster, the chart, the facets — and a first query with no
bound makes the store aggregate its whole history to draw one page. On a
development database that is free; on a deployment holding weeks of runs it is
the difference between a panel that opens and one that hangs on connect.

```typescript
new CNSDevToolsServer(repository, stimulationRepository, actions, {
    defaultWindowMs: 60 * 60 * 1000,   // this deployment opens on the last hour
});
```

`0` means the whole history — for a store small enough that the bound only gets
in the way.

It is a **default**, not a filter: it fills the range picker on connect, and the
moment you change the range — or arrive on a link that already carries `since` /
`until` — the panel keeps what it was given and never re-applies the default. A
link to an incident from three days ago shows that incident, not an empty
five-minute window.

The window prunes the store's read before it aggregates, on the same index the
attempts are ordered by, so it costs nothing to widen for one query and go back.

## One-button example

`@cnstra/examples` wires all of this over a real broker + the actual panel:

```bash
npm run demo:panel:bull      # BullMQ (Redis) + the DevTools panel on :8080
npm run demo:panel:pgboss    # pg-boss (Postgres) + the panel
```

Open `http://localhost:8080` → the Explorer shows the broker-backed runs (watch one fail,
**Retry** to resume the frontier, **Clone** for a fresh run). See
[runnable examples](../examples/runnable-examples.md).

## See also

- [Resumable execution](../advanced/resumable-execution.md) — the model, `observe` vs `resume`, stores & bounds.
- [Log correlation](../recipes/log-correlation.md) — tie your logs to the same run ids the panel shows.
