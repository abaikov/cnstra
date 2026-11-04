---
id: retry
title: Retries
sidebar_label: Retries
slug: /recipes/retry
---

Implement retries by looping within the same neuron. **Carry the attempt count in the signal payload** — all per-run data flows through payloads.

```ts
import { neuron, collateral } from '@cnstra/core';

// Collaterals owned by the retry neuron
const tryFetch = collateral<{ url: string; attempt?: number }>();
const completed = collateral<{ ok: true; data: unknown }>();
const failed = collateral<{ ok: false; error: unknown }>();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const fetchWithRetry = neuron({ tryFetch, completed, failed })
  .dendrite({
    collateral: tryFetch,
    response: async (payload, axon) => {
      // The attempt count rides on the payload — no per-neuron state needed.
      const attempt = (payload.attempt ?? 0) + 1;

      try {
        const res = await fetch(payload.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return axon.completed.createSignal({ ok: true, data });
      } catch (error) {
        if (attempt < 3) {
          await sleep(2 ** (attempt - 1) * 250); // backoff: 250ms, 500ms, ...
          // self-loop: re-emit our own input collateral, carrying the new attempt.
          return axon.tryFetch.createSignal({ url: payload.url, attempt });
        }
        return axon.failed.createSignal({ ok: false, error });
      }
    },
  });
```

Notes
- Self-loop uses the neuron's own input collateral (`tryFetch`), complying with ownership.
- **All per-run data (url, attempt) flows through payloads** — CNStra has no mutable per-neuron store.
- Prefer queue-native retries (e.g., BullMQ, SQS) in production for visibility; use local retries for transient client/network work.
