---
id: retry
title: Retries
sidebar_label: Retries
slug: /recipes/retry
---

Implement retries by looping within the same neuron, storing attempt count in context, and backing off between tries. This preserves signal ownership and keeps orchestration local.

```ts
import { withCtx, collateral } from '@cnstra/core';

// Collaterals owned by the retry neuron
const tryFetch = collateral<{ url: string }>('retry:tryFetch');
const completed = collateral<{ ok: true; data: unknown }>('retry:completed');
const failed = collateral<{ ok: false; error: unknown }>('retry:failed');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const fetchWithRetry = withCtx<{ attempt?: number }>()
  .neuron('fetch-with-retry', { tryFetch, completed, failed })
  .dendrite({
    collateral: tryFetch,
    response: async (payload, axon, ctx) => {
      const attempt = (ctx.get()?.attempt ?? 0) + 1;
      ctx.set({ attempt });

      try {
        const res = await fetch(payload.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return axon.completed.createSignal({ ok: true, data });
      } catch (error) {
        if (attempt < 3) {
          await sleep(2 ** (attempt - 1) * 250); // backoff: 250ms, 500ms, ...
          // self-loop: re-emit our own input collateral
          return axon.tryFetch.createSignal({ url: payload.url });
        }
        return axon.failed.createSignal({ ok: false, error });
      }
    },
  });
```

Notes
- Self-loop uses the neuron's own input collateral (`retry:tryFetch`), complying with ownership.
- Attempt count is stored in `ctx`; backoff grows per attempt.
- Prefer queue-native retries (e.g., BullMQ, SQS) in production for visibility; use local retries for transient client/network work.
