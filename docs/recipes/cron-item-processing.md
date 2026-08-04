---
id: cron-item-processing
title: Cron pulls items — show processing per item
sidebar_label: Cron item processing
slug: /recipes/cron-item-processing
description: The classic pattern — write items to your own DB table, a cron pulls N pending and processes each through CNStra — with each item's run visible live in the DevTools admin, keyed by your item id.
keywords: [cron, batch processing, item queue, admin, per-item, stimulationId, persist-postgres, observe, retention]
---

A very common setup: you write work **items to your own table** (`imports`, `orders`, …), a
**cron pulls N pending** rows and processes each. You want an admin where you can literally see
*"work started on item-123 → these steps → done / failed"*.

CNStra does this with the durable store + the DevTools panel — and the trick is: **key each run
by your item id**.

## Process each item as a run keyed by the item id

You don't need a queue for this — your own table *is* the queue. Wire a
`CNSStimulationPersistor` per item, with `stimulationId = your item id`, writing to a Postgres
run store:

```ts
import { CNS } from '@cnstra/core';
import { CNSStimulationPersistor } from '@cnstra/persist';
import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';
import { registry, input } from './neurons'; // your CNS registry + entry collateral

const cns = new CNS([/* your neurons */]);
const runStore = new CNSPostgresStimulationRepository({ connectionString: DATABASE_URL });

// ── the cron tick ──
async function tick(batchSize = 20) {
  const items = await db.query(
    `select id, payload from imports where status = 'pending' order by created_at limit $1`,
    [batchSize],
  );

  for (const item of items.rows) {
    const runId = `import:${item.id}`;          // ← the run the admin shows == your item

    const persistor = new CNSStimulationPersistor({
      repository: runStore,
      registry,
      stimulationId: runId,
      stimulationAttemptId: `${runId}#1`,
      attemptNumber: 1,
      entry: [{ collateralName: 'input', payload: item.payload }],
      volume: 'full',                            // full run/attempt/task history
      scopeName: 'imports',                      // groups these runs in the panel
    });

    try {
      await cns
        .stimulate(input.createSignal(item.payload), {
          onResponse: persistor.onResponse,      // records every hop
          stimulationContext: { stimulationId: runId }, // logs correlate to the same id
        })
        .waitUntilComplete();
      await db.query(`update imports set status = 'done' where id = $1`, [item.id]);
    } catch {
      await db.query(`update imports set status = 'failed' where id = $1`, [item.id]);
    } finally {
      persistor.dispose();
    }
  }
}
```

Every hop is recorded, keyed by `import:<id>`, as it runs.

## See it in the admin

Point the DevTools server's run store at the **same** `runStore`, and the panel becomes the
per-item admin — no bespoke UI:

```ts
import { CNSDevToolsServer } from '@cnstra/devtools-server';
const server = new CNSDevToolsServer(appTopologyRepo, runStore);
```

Open the panel → **⚡ Stimulations** / **💀 Durable Runs**: each row is `import:123`, and you see
it go `running → completed / failed` with the neuron-by-neuron waterfall (and a **Retry** on the
resumable frontier of a failed one). Refresh is a ~2s poll — near-live.

Building your own admin instead? Read the store directly:

```ts
const runs = await runStore.listStimulations({ scopeName: 'imports' }); // roster
const attempts = await runStore.getAttempts(`import:${itemId}`);
const tasks = await runStore.getTasks(`import:${itemId}#1`);            // the waterfall
```

## Keep the run history bounded

A run per item accumulates forever — prune on a schedule (the same cron is fine):

```ts
await runStore.deleteStale(7 * 24 * 60 * 60 * 1000); // drop runs untouched for a week
```

## Honest limits

- The admin shows CNStra's **run/attempt/task** model, correlated to your item **by the shared
  id** (`stimulationId = import:<id>`). It does **not** auto-join your `imports` table — link
  between them by that id.
- The panel shows the **runs**, not your pending queue; items sit in your table until a tick
  picks them up.
- "Live" is a ~2s poll, not a per-hop push stream.

## When to add a queue instead

If you'd rather have **the queue manage pulling + retries/backoff/scheduling** than your cron,
move the items onto [pg-boss](/docs/integrations/pg-boss) or [BullMQ](/docs/integrations/bullmq)
and pass `observe: runStore` to the worker. There the run id is the job id — carry your item id
in `scopeName` (or a `singletonKey`) to keep the correlation. See
[Durable execution](/docs/advanced/durable-execution) for `resume` vs `observe`.
