---
id: stimulation-options
title: Stimulation Options
sidebar_label: Stimulation Options
slug: /core/stimulation-options
---

- `maxNeuronHops?: number` — limit traversal depth
- `onResponse?: (response) => void | Promise<void>` — tap into flow and completion (async supported)
- `abortSignal?: AbortSignal` — graceful cancel
- `concurrency?: number` — per-run concurrency limit
- `ctx?: ICNSStimulationContextStore` — reuse context store (in‑process)
- `modality?: TCNSModality` — optional modality routing for `modalityDendrite`
- `afferentPath?: TCNSAfferentPath` — optional afferent path selection for `modalityDendrite`
- `stimulationContext?: object` — optional user-defined bag for listeners/handlers

```ts
const controller = new AbortController();
const stimulation = cns.stimulate(signal, {
  maxNeuronHops: 10, // optional, disabled by default
  abortSignal: controller.signal,
  onResponse: r => {
    if (r.queueLength === 0) console.log('done');
  }
});
await stimulation.waitUntilComplete();
```

### Async listeners and failure semantics

- Local `onResponse` and all global listeners (added via `addResponseListener`) can be synchronous or asynchronous.
- They run in parallel for each response. If any throws or returns a rejected Promise, the `stimulation.waitUntilComplete()` Promise rejects.
- If all listeners are synchronous, CNStra does not introduce extra async deferrals for that response.

```ts
// Async onResponse example (e.g., persist to DB/Redis)
const stimulation = cns.stimulate(signal, {
  onResponse: async (r) => {
    if (r.outputSignal) {
      await repo.save(r.outputSignal);
    }
  }
});
await stimulation.waitUntilComplete();
```
