---
id: persistence
title: State Persistence & Resume
sidebar_label: Persistence & Resume
slug: /advanced/persistence
description: How to use CNSPersistOptionsRegistry to serialize running stimulations, persist them to a database, and resume after a process restart.
keywords: [persistence, resume, restart, CNSPersistOptionsRegistry, state, serialization, message broker, BullMQ, crash recovery]
---

When you run large queues or long-lived flows in production, processes can restart — deploys, crashes, OOM kills. `CNSPersistOptionsRegistry` gives you the tools to serialize in-flight stimulations so they can be resumed after a restart.

## The problem

CNStra stimulations are in-memory. When a process dies, all pending signals are lost. For short-lived flows this is fine. For long-running flows — multi-step order processing, batch jobs, import pipelines — you need a way to know what was running and pick up where you left off.

## How CNSPersistOptionsRegistry helps

The registry maps **object references** ↔ **stable string names**:

```
deckNeuron (object ref)  ←→  "deckNeuron" (string, safe to store in DB)
deckAxon.created (object ref)  ←→  "deckCreated" (string, safe to store in DB)
```

This lets you serialize "which signal was in flight" as a plain JSON record, then deserialize it back into a real signal on restart.

## Setup

Create one registry instance and register neurons and collaterals from each file:

```ts
// src/neurons/registry.ts — create once
import { CNSPersistOptionsRegistry } from '@cnstra/core';
export const registry = new CNSPersistOptionsRegistry();
```

```ts
// src/neurons/deck.ts — register in your neuron's own file
import { collateral, withCtx } from '@cnstra/core';
import { registry } from './registry';

export const deckCreated = collateral<{ deckId: string }>();
export const deckArchived = collateral<{ deckId: string }>();
export const importStarted = collateral<{ importId: string }>();  // external entry point

export const deckNeuron = withCtx()
    .neuron({ deckCreated, deckArchived })
    .bind({ importStarted }, {
        importStarted: ({ importId }, axon) => axon.deckCreated.createSignal({ deckId: importId }),
    });

registry
    .register('deckNeuron', deckNeuron)           // registers neuron + its axon collaterals
    .registerCollateral('importStarted', importStarted);  // standalone entry-point collateral
```

Register **only the collaterals that are entry points** — the ones you actually stimulate from outside (from a job queue, webhook, cron). You don't need to register intermediate collaterals that are emitted between neurons internally.

## Pattern 1: Message broker with named signals

The most common pattern. Each job stores a collateral name + payload. On restart, the broker re-delivers unprocessed jobs and the worker reconstructs the signal by name.

```ts
import Queue from 'bullmq';

// Enqueue — store collateral name as a string
await queue.add('process', {
    collateralName: 'deckCreated',
    payload: { deckId: 'deck-123', userId: 'user-456' },
});

// Worker — reconstruct signal from name on any process (after restart too)
new Worker('process', async (job) => {
    const collateral = registry.getCollateral(job.data.collateralName);
    if (!collateral) throw new Error(`Unknown collateral: ${job.data.collateralName}`);

    const stimulation = cns.stimulate(
        collateral.createSignal(job.data.payload)
    );
    await stimulation.waitUntilComplete();
});
```

Because the name `"deckCreated"` is a stable string in your DB, the worker can reconstruct the exact signal on any restart.

## Pattern 2: Checkpoint in-flight stimulations

For very long flows you may want to checkpoint progress — save which stimulation is running so you can detect stale ones after a crash.

```ts
const stimulationId = `stim-${crypto.randomUUID()}`;

// Save to DB before starting
await db.stimulations.create({
    id: stimulationId,
    collateralName: 'importStarted',
    payload: { importId: 'import-123' },
    status: 'running',
    startedAt: new Date(),
});

// Register the in-flight stimulation
const stimulation = cns.stimulate(
    importAxon.started.createSignal({ importId: 'import-123' })
);
registry.addStimulation(stimulation, { stimulationId });

// Clean up on complete
stimulation.waitUntilComplete().then(() => {
    registry.removeStimulation(stimulationId);
    db.stimulations.update(stimulationId, { status: 'done' });
}).catch(() => {
    registry.removeStimulation(stimulationId);
    db.stimulations.update(stimulationId, { status: 'failed' });
});
```

**On restart** — find stale `running` records in the DB and re-stimulate:

```ts
const stale = await db.stimulations.findAll({ status: 'running' });

for (const record of stale) {
    const collateral = registry.getCollateral(record.collateralName);
    if (!collateral) continue;

    const stimulation = cns.stimulate(
        collateral.createSignal(record.payload)
    );
    registry.addStimulation(stimulation, { stimulationId: record.id });
    // update status back to 'running'
}
```

## Pattern 3: Full serialization with context

When you need to resume with the same context (retry state, attempt counters), pass a shared context store:

```ts
import { CNSStimulationContextStore } from '@cnstra/core';

// Save context to DB alongside stimulation record
const ctx = new CNSStimulationContextStore();
const stimulation = cns.stimulate(signal, { ctx });

// Serialize context periodically
stimulation.waitUntilComplete().catch(async () => {
    const serialized = ctx.serialize(); // if your store supports it
    await db.stimulations.update(id, {
        status: 'failed',
        context: serialized,
    });
});

// Resume with restored context
const restoredCtx = new CNSStimulationContextStore();
restoredCtx.restore(savedContext);
cns.stimulate(signal, { ctx: restoredCtx });
```

See [Custom Context Store](/docs/advanced/custom-context-store) for implementing serializable context.

## What to register

| Register | Why |
|---|---|
| Entry-point collaterals (stimulated from outside) | So workers/jobs can reconstruct signals by name |
| Neurons that own persisted domain models | So you can look them up by name for diagnostics |
| Active stimulations (optional) | So you can detect and recover stale ones after a crash |

**Don't register** internal collaterals emitted between neurons — those are intermediate steps, not resumption points.

## Registry in devtools vs production

The same registry instance works for both persistence and devtools/AI inspection. The per-file `register()` approach is recommended for production since it co-locates registration with the neuron definition:

```ts
// src/neurons/registry.ts
import { CNSPersistOptionsRegistry } from '@cnstra/core';
export const registry = new CNSPersistOptionsRegistry();

// src/neurons/deck.ts
import { registry } from './registry';
registry
    .register('deckNeuron', deckNeuron)
    .registerCollateral('importStarted', importStarted);
```

For simple projects where all neurons are in one place, `createPersistRegistry` is a convenient shorthand:

```ts
import { createPersistRegistry } from '@cnstra/core';
export const registry = createPersistRegistry({ deckNeuron, cardNeuron, uiNeuron });
// equivalent to calling register() for each neuron
```

Both produce the same result and can be passed to devtools, MCP, and BullMQ workers.
