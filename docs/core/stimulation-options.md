---
id: stimulation-options
title: Stimulation Options
sidebar_label: Stimulation Options
slug: /core/stimulation-options
---

- `maxNeuronHops?: number` — limit traversal depth
- `onResponse?: (response) => void` — tap into flow and completion
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
