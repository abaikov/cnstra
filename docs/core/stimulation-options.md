---
id: stimulation-options
title: Stimulation Options
sidebar_label: Stimulation Options
slug: /core/stimulation-options
---

- `maxNeuronHops?: number` — limit traversal depth
- `onResponse?: (response) => void | Promise<void>` — tap into flow and completion (async supported)
- `abortSignal?: AbortSignal` — graceful cancel
- `stimulationId?: string` — custom id
- `allowName?: (collateralName: string) => boolean` — filter collaterals
- `concurrency?: number` — per-run concurrency limit
- `ctx?: ICNSStimulationContextStore` — reuse context
- `createContextStore?: () => ICNSStimulationContextStore` — custom store

```ts
const controller = new AbortController();
await cns.stimulate(signal, {
  maxNeuronHops: 50,
  abortSignal: controller.signal,
  onResponse: r => {
    if (r.queueLength === 0) console.log('done');
  }
});
```

### Async listeners and failure semantics

- Local `onResponse` and all global listeners (added via `addResponseListener`) can be synchronous or asynchronous.
- They run in parallel for each response. If any throws or returns a rejected Promise, the current `stimulate(...)` Promise rejects.
- If all listeners are synchronous, CNStra does not introduce extra async deferrals for that response.

```ts
// Async onResponse example (e.g., persist to DB/Redis)
await cns.stimulate(signal, {
  onResponse: async (r) => {
    if (r.outputSignal) {
      await repo.save(r.stimulationId, r.outputSignal);
    }
  }
});
```
