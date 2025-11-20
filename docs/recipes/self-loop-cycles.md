---
id: self-loop-cycles
title: Cycles with Self-loops
sidebar_label: Self-loops
slug: /recipes/self-loop-cycles
---

Use self-loops to model cycles/iterations inside a single neuron. **Pass data through signal payloads**, not context. Context is for per-neuron per-stimulation metadata only.

Why self-loops
- Deterministic: one place owns the loop logic, no hidden cross-neuron chatter
- Data flows through payloads: each iteration passes state in the signal
- Ownership: the neuron emits only its own input collateral to continue

Counter example (iterate until max)

```ts
import { collateral, neuron } from '@cnstra/core';

const step = collateral<{ amount: number; total?: number; attempt?: number }>('counter:step');
const done = collateral<{ total: number }>('counter:done');

export const counter = neuron('counter', { step, done })
  .dendrite({
    collateral: step,
    response: (payload, axon) => {
      const total = (payload.total || 0) + payload.amount;
      const attempt = (payload.attempt || 0) + 1;

      if (attempt < 5) {
        // self-loop: pass state through payload
        return axon.step.createSignal({ amount: payload.amount, total, attempt });
      }
      return axon.done.createSignal({ total });
    },
  });
```

Pagination example (loop until no next page)

```ts
import { collateral, neuron } from '@cnstra/core';

const tryPage = collateral<{ cursor?: string; items?: unknown[] }>('pager:try');
const finished = collateral<{ items: unknown[] }>('pager:finished');

async function fetchPage(cursor?: string): Promise<{ items: unknown[]; next?: string }> {
  // replace with real API call
  return { items: [{ id: cursor ?? '0' }], next: cursor ? undefined : '1' };
}

export const pager = neuron('pager', { tryPage, finished })
  .dendrite({
    collateral: tryPage,
    response: async (payload, axon, ctx) => {
      if (ctx.abortSignal?.aborted) return; // cooperative cancel

      // Use payload cursor, not context
      const { items, next } = await fetchPage(payload.cursor);
      const accumulatedItems = [...(payload.items || []), ...items];

      if (next) {
        // self-loop: pass accumulated data through payload
        return axon.tryPage.createSignal({ cursor: next, items: accumulatedItems });
      }
      return axon.finished.createSignal({ items: accumulatedItems });
    },
  });
```

Tips
- **Pass data through signal payloads**, not context
- Context is for per-neuron per-stimulation metadata (retry attempts, debounce state)
- Check `ctx.abortSignal` between iterations
- For retries, prefer a separate self-loop neuron with backoff per attempt
