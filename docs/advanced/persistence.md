---
id: persistence
title: State Persistence & Resume — how it works
sidebar_label: Persistence & Resume
slug: /advanced/persistence
description: How CNStra serializes a running stimulation by name, checkpoints its frontier, and resumes it after a restart — the registry, the CNSProgressSerializer, checkpoint recorders, and cns.activate().
keywords: [persistence, resume, checkpoint, CNSProgressSerializer, CNSProgressRecorder, CNSStimulationPersistor, TCNSProgress, activate, getOutstandingTasks, registry, crash recovery]
---

CNStra stimulations are **in-memory**, and identity is by **object reference** — a neuron/
collateral is *the object*, and context is a `Map<object, unknown>`. That is fast, but object
references can't cross a process boundary. So to survive a restart you serialize the run's
state **by name** and rebuild it on the other side. This page explains the machinery; for the
run model (Stimulation → Attempt → Task) and the productized worker seams, see
[Durable execution](./durable-execution.md).

## The bridge: a name ⇄ object registry

`CNSPersistOptionsRegistry` maps object references ↔ stable string names, so anything you
store is plain JSON and can be rebuilt on any process:

```ts
// src/neurons/registry.ts — create once, register in each neuron's own file
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
export const registry = new CNSPersistOptionsRegistry();
```

```ts
// src/neurons/import.ts
import { registry } from './registry';

registry
  .register('importUser', importUserNeuron)   // the neuron + ALL its axon collaterals, by name
  .registerCollateral('input', input);         // a standalone ENTRY collateral (no neuron owns it)
```

> **Register every name that can appear in the frontier** — each neuron, its collaterals, AND
> the external entry collaterals you stimulate from (those are no neuron's axon, so they need an
> explicit `registerCollateral`). For a whole map at once:
> `CNSPersistOptionsRegistryFactory.create({ importUser, … })` (it registers each neuron's axon
> collaterals automatically; still `registerCollateral` your entry collaterals).

## The unit of state: `TCNSProgress`

The resumable state of a running stimulation is its **frontier + context**, all by name:

```ts
type TCNSProgress = {
  tasks: TCNSSerializedTask[];              // the OUTSTANDING work (frontier ∪ failed), by name
  context: Record<string /*neuronName*/, unknown>; // per-neuron ctx (attempt counters, etc.)
};
```

`tasks` is what's left to do; `context` is the state those tasks need. That's the entire
checkpoint — no topology (code is its source of truth).

## How resume works (the primitive)

Three steps, all through the registry:

```ts
import { CNSProgressSerializer } from '@cnstra/persist';
const serializer = new CNSProgressSerializer(registry);

// 1) SERIALIZE the live frontier → a JSON-safe TCNSProgress
const progress = serializer.serialize(stimulation);   // reads stimulation.getOutstandingTasks()
await store.save(runId, progress);                     // your DB / KV / queue-job progress

// … process restarts …

// 2) HYDRATE the names back into real tasks + a context store
const { tasks, ctx } = serializer.hydrate(progress);

// 3) ACTIVATE — resume ONLY the outstanding branch (not from the entry), with its context
cns.activate(tasks, { ctx });
```

`cns.activate(tasks, { ctx })` is the resume counterpart of `cns.stimulate(signal)`: instead of
starting from an entry signal, it re-injects the exact outstanding tasks. Only the unfinished
branch runs, and its neurons see their previous context.

## Checkpointing as the run advances

Serializing once at the end only helps if the process dies *after* that write. To survive a
crash mid-run, checkpoint the frontier **as it moves**. Two ready-made recorders wire into
`onResponse` (every settled hop):

```ts
import { CNSProgressRecorder } from '@cnstra/persist';

const recorder = new CNSProgressRecorder({ serializer, repository: store, key: runId });
cns.stimulate(signal, { onResponse: recorder.onResponse });
// on teardown: recorder.dispose();
```

- `CNSProgressRecorder` writes the **frontier** (`TCNSProgress`) to an `ICNSProgressRepository`
  (`save/load/delete` by key) on a cadence — by default debounced with a max-staleness bound,
  and **flushed immediately on error** so a failed run's exact frontier is always persisted.
- Want the full **Stimulation → Attempt → Task** history too (not just the frontier)? Use
  `CNSStimulationPersistor` → an `ICNSStimulationRepository`. See
  [Durable execution](./durable-execution.md).

### Per-hop barrier (exactly-resumable)

Because `onResponse` may return a promise and CNStra **awaits it before the next hop**, a write
you `await` there is a transactional boundary: the next hop cannot start until the checkpoint
lands. A crash between the two resumes exactly the not-yet-done work — no lost or double hops.
See [Response Listeners → async listeners are a barrier](../recipes/response-listeners.md#async-listeners-are-a-barrier-this-is-how-checkpointing-works).

## Where progress is stored

`ICNSProgressRepository` is a tiny `save(key, progress) / load(key) / delete(key)` seam — plug
in anything:

| Store | Package |
|---|---|
| In-memory (dev/tests) | `CNSInMemoryProgressRepository` (`@cnstra/persist`) |
| Redis | `CNSRedisProgressRepository` (`@cnstra/progress-redis`) |
| Postgres (for pg-boss) | `CNSPgBossProgressRepository` (`@cnstra/pg-boss/postgres-progress`) |
| BullMQ's own job progress | built into `@cnstra/bullmq` (`resume: {}`) |

## You rarely wire this by hand

The queue integrations do all of the above for you — one job = one stimulation, checkpoint on
each hop, resume the frontier on retry:

```ts
// @cnstra/pg-boss / @cnstra/bullmq
await createCNSWorker({ boss, cns, registry, queue: 'cns', resume: { repository: store } });
```

Reach for the raw serializer/recorder only when you resume outside a queue (a cron sweep of
stale `running` rows, a custom scheduler, etc.). See [pg-boss](/docs/integrations/pg-boss) and
[BullMQ](/docs/integrations/bullmq).

## What to register

| Register | Why |
|---|---|
| Every neuron (`register`) | resolves neuron + axon collaterals by name |
| Entry collaterals (`registerCollateral`) | external triggers are no neuron's axon — needed so the frontier serializes |
| Nothing else | intermediate collaterals come from `register`; topology is never persisted |

The **same** registry powers persistence, the queue workers, and DevTools/AI inspection.
