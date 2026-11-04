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
[Resumable execution](./resumable-execution.md).

## The bridge: a name ⇄ object registry

`CNSPersistOptionsRegistry` maps object references ↔ stable string names, so anything you
store is plain JSON and can be rebuilt on any process:

```ts file=registry.ts
// src/neurons/registry.ts — create once, register in each neuron's own file
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
export const registry = new CNSPersistOptionsRegistry();
```

```ts file=import.ts
// src/neurons/import.ts
import { collateral, neuron } from '@cnstra/core';
import { registry } from './registry';

export const input = collateral<{ email: string }>();
export const userImported = collateral<{ userId: string }>();
export const importUserNeuron = neuron({ userImported }).dendrite({
  collateral: input,
  response: (payload, axon) => axon.userImported.createSignal({ userId: payload.email }),
});

registry
  .register('importUser', importUserNeuron)   // the neuron + its axon collaterals: 'importUser.userImported'
  .registerCollateral('input', input);         // a standalone ENTRY collateral (no neuron owns it)
```

> **Register every name that can appear in the frontier** — each neuron, its collaterals, AND
> the external entry collaterals you stimulate from (those are no neuron's axon, so they need an
> explicit name). An axon collateral is named `<neuron name>.<axon key>` unless you name it.
> For a whole map at once, `CNSPersistOptionsRegistryFactory.create({ importUser: importUserNeuron, input })`
> takes neurons, entry collaterals and modalities in one object.
>
> A name belongs to one object. Registering another neuron, collateral or modality under a
> taken name throws, and so does a second name for the same object, so two graphs can never
> resolve each other's collaterals on resume.

### Namespaces: a library graph inside your registry

A nested object is a namespace: its key and a dot go in front of every name inside it. A
library can ship its graph as a factory function and never collide with your names, or with
a second copy of itself:

```ts file=payments.ts
import { collateral, neuron } from '@cnstra/core';
import { CNSFactory } from '@cnstra/factory';

export const createPaymentsGraph = (gateway: { charge(orderId: string): Promise<void> }) => {
  const charge = collateral<{ orderId: string }>();
  const charged = collateral<{ orderId: string }>();
  const chargeNeuron = neuron({ charged }).dendrite({
    collateral: charge,
    response: async (payload, axon) => {
      await gateway.charge(payload.orderId);
      return axon.charged.createSignal(payload);
    },
  });
  return { charge, charged, chargeNeuron };
};

const gateway = { charge: async (_orderId: string) => {} };
const shop = CNSFactory.create({
  payments: createPaymentsGraph(gateway),
  refunds: createPaymentsGraph(gateway),
});
// shop.registry: payments.chargeNeuron, payments.charge, payments.chargeNeuron.charged, refunds.chargeNeuron, …
```

A collateral listed next to the neuron that owns it, like `charged` above, keeps the owner's
name; only a collateral no listed neuron owns, like `charge`, is named by its own key.

## The unit of state: `TCNSProgress`

The resumable state of a running stimulation is its **frontier** plus whatever was attached to the run, all by name:

```ts signature
type TCNSProgress = {
  tasks: TCNSPlannedTaskJSON[];        // the OUTSTANDING work (frontier ∪ failed), by name
  stimulationContext?: TCNSContextStore; // the run's context store, portable part
  modalityName?: string;
  afferentPathName?: string;
};
```

`tasks` is what's left to do, and each one carries its own input signal — so re-driving
the frontier needs nothing else. No topology travels: code is its source of truth.

The context stores travel too, because they belong to the work rather than to the
process that ran it: the run's own on the record above, and each activation's on
its frontier task (`TCNSPlannedTaskJSON.activationContext`). Only the portable
part — a live handle cannot be rebuilt on the far side, so it is left behind
rather than half-restored. `hydrate()` hands the run's store back for you to pass
straight into `activate`:

```ts setup
import { CNS, collateral } from '@cnstra/core';
import type { TCNSNeuron } from '@cnstra/types';
import type {
  CNSPersistOptionsRegistry,
  ICNSProgressRepository,
  ICNSStimulationRepository,
  TCNSProgress,
  TCNSSignalJSON,
} from '@cnstra/persist';
import type { ICNSPgBossLike } from '@cnstra/pg-boss';

declare const registry: CNSPersistOptionsRegistry;
declare const cns: CNS<TCNSNeuron>;
declare const store: ICNSProgressRepository;
declare const stimulationStore: ICNSStimulationRepository;
declare const boss: ICNSPgBossLike;
declare const runId: string;
declare const saved: TCNSProgress;
declare const entry: TCNSSignalJSON[];

const signal = collateral<{ userId: string }>().createSignal({ userId: 'u1' });
const stimulation = cns.stimulate(signal);
```

```ts
import { CNSProgressSerializer } from '@cnstra/persist';
const serializer = new CNSProgressSerializer(registry);

const { tasks, stimulationContext } = serializer.hydrate(saved);
cns.activate(tasks, { stimulationContext });
```

## How resume works (the primitive)

Three steps, all through the registry:

```ts
import { CNSProgressSerializer } from '@cnstra/persist';
const serializer = new CNSProgressSerializer(registry);

// 1) SERIALIZE the live frontier → a JSON-safe TCNSProgress
const progress = serializer.serialize(stimulation);   // reads stimulation.getOutstandingTasks()
await store.save(runId, progress);                     // your DB / KV / queue-job progress

// … process restarts …

// 2) HYDRATE the names back into real tasks
const { tasks } = serializer.hydrate(progress);

// 3) ACTIVATE — resume ONLY the outstanding branch (not from the entry)
cns.activate(tasks);
```

`cns.activate(tasks)` is the resume counterpart of `cns.stimulate(signal)`: instead of
starting from an entry signal, it re-injects the exact outstanding tasks. Only the unfinished
branch runs. Each task carries its own input signal (with payload), so no extra per-run state
has to be restored — everything the branch needs travels in the signals themselves.

## Checkpointing as the run advances

Serializing once at the end only helps if the process dies *after* that write. To survive a
crash mid-run, checkpoint the frontier **as it moves**. Two ready-made recorders wire into
`onResponse` (every settled hop):

```ts
import { CNSProgressRecorder, CNSProgressSerializer } from '@cnstra/persist';

const serializer = new CNSProgressSerializer(registry);
const recorder = new CNSProgressRecorder({ serializer, repository: store, key: runId });
cns.stimulate(signal, { onResponse: recorder.onResponse });
// on teardown: recorder.dispose();
```

- `CNSProgressRecorder` writes the **frontier** (`TCNSProgress`) to an `ICNSProgressRepository`
  (`save/load/delete` by key) on a cadence — by default debounced with a max-staleness bound,
  and **flushed immediately on error** so a failed run's exact frontier is always persisted.
- Want the full **Stimulation → Attempt → Task** history too (not just the frontier)? Use
  `CNSStimulationPersistor` → an `ICNSStimulationRepository`. See
  [Resumable execution](./resumable-execution.md).

### Per-hop barrier (exactly-resumable)

Because `onResponse` may return a promise and CNStra **awaits it before the next hop**, a write
you `await` there is a transactional boundary: the next hop cannot start until the checkpoint
lands. A crash between the two resumes exactly the not-yet-done work — no lost or double hops.
See [Response Listeners → async listeners are a barrier](../recipes/response-listeners.md#async-listeners-are-a-barrier-this-is-how-checkpointing-works).

`CNSStimulationPersistor` does **not** take that path by default: its writes are
fire-and-forget, so the run keeps moving while they land. Ask for the barrier
explicitly:

```ts
import { CNSStimulationPersistor } from '@cnstra/persist';
import { buildCNSAttemptId } from '@cnstra/persist-dto';

new CNSStimulationPersistor({
  repository: stimulationStore,
  registry,
  barrier: true,
  stimulationId: runId,
  stimulationAttemptId: buildCNSAttemptId(runId, 1),
  attemptNumber: 1,
  entry,
});
```

Two consequences follow from what the guarantee is, and both are deliberate:

- it **flushes on every response** and ignores the cadence `strategy` — a coalesced
  write that may never happen for this response cannot be a barrier for it;
- a **failed write fails the run**, because continuing past a checkpoint that was
  not stored is exactly what you asked not to happen.

Without it, a failed write is reported and dropped. If you want it retried or
dead-lettered instead, put a chain in front of the store:

```ts
import { withCNSWriteChain, retryCNSWrites, redactCNSPayload, capCNSPayload } from '@cnstra/persist';

const repository = withCNSWriteChain(
    [retryCNSWrites({ attempts: 3 }), redactCNSPayload(['card', 'token']), capCNSPayload(64_000)],
    stimulationStore
);
```

Those links are safe to retry because the writes are idempotent: a stimulation and an
attempt are upserts by id, and a task is keyed by `(stimulationAttemptId, index)`.

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
import { createCNSWorker } from '@cnstra/pg-boss';

await createCNSWorker({ boss, cns, registry, queue: 'cns', resume: { repository: store } });
```

Reach for the raw serializer/recorder only when you resume outside a queue (a cron sweep of
stale `running` rows, a custom scheduler, etc.). See [pg-boss](/docs/integrations/pg-boss) and
[BullMQ](/docs/integrations/bullmq).

## What to register

| Register | Why |
|---|---|
| Every neuron (`register`) | resolves neuron + axon collaterals by name |
| Entry collaterals (`registerCollateral`, or listed in the factory object) | external triggers are no neuron's axon — needed so the frontier serializes |
| Modalities (`registerModality('flow', flow)`) | a run started with `{ modality, afferentPath }` resumes on the same path; the path is stored by its key in `modality({ … })` |
| Nothing else | intermediate collaterals come from `register`; topology is never persisted |

The **same** registry powers persistence, the queue workers, and DevTools/AI inspection.
