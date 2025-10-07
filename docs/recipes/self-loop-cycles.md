---
id: self-loop-cycles
title: Cycles with Self-loops
sidebar_label: Self-loops
slug: /recipes/self-loop-cycles
---

Use self-loops to model cycles/iterations inside a single neuron while keeping ownership and state in context.

Why self-loops
- Deterministic: one place owns the loop logic, no hidden cross-neuron chatter
- Local state: `ctx` carries counters/cursors/accumulators
- Ownership: the neuron emits only its own input collateral to continue

Counter example (iterate until max)

```ts
import { withCtx, collateral } from '@cnstra/core';

const step = collateral<{ amount: number }>('counter:step');
const done = collateral<{ total: number }>('counter:done');

export const counter = withCtx<{ total: number; attempt: number }>()
  .neuron('counter', { step, done })
  .dendrite({
    collateral: step,
    response: (payload, axon, ctx) => {
      const prev = ctx.get() ?? { total: 0, attempt: 0 };
      const next = { total: prev.total + payload.amount, attempt: prev.attempt + 1 };
      ctx.set(next);

      if (next.attempt < 5) {
        // self-loop: continue the cycle
        return axon.step.createSignal({ amount: payload.amount });
      }
      return axon.done.createSignal({ total: next.total });
    },
  });
```

Pagination example (loop until no next page)

```ts
import { withCtx, collateral } from '@cnstra/core';

const tryPage = collateral<{ cursor?: string }>('pager:try');
const finished = collateral<{ items: unknown[] }>('pager:finished');

async function fetchPage(cursor?: string): Promise<{ items: unknown[]; next?: string }> {
  // replace with real API call
  return { items: [{ id: cursor ?? '0' }], next: cursor ? undefined : '1' };
}

export const pager = withCtx<{ cursor?: string; items: unknown[] }>()
  .neuron('pager', { tryPage, finished })
  .dendrite({
    collateral: tryPage,
    response: async (payload, axon, ctx) => {
      if (ctx.abortSignal?.aborted) return; // cooperative cancel

      const { items, next } = await fetchPage(payload.cursor ?? ctx.get()?.cursor);
      const prev = ctx.get() ?? { items: [] as unknown[], cursor: undefined as string | undefined };
      ctx.set({ items: [...prev.items, ...items], cursor: next });

      if (next) {
        return axon.tryPage.createSignal({ cursor: next }); // self-loop until no next
      }
      return axon.finished.createSignal({ items: ctx.get()!.items });
    },
  });
```

Tips
- Store only what you need in `ctx` (counters, cursors, accumulators)
- Check `ctx.abortSignal` between iterations
- For retries, prefer a separate self-loop neuron with backoff per attempt
