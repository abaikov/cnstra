---
id: batching-state-managers
title: Batching State Managers with CNStra - Commit Stores at Real Work Boundaries
sidebar_label: Batching state managers
slug: /recipes/batching-state-managers
description: Drive OIMDB, MobX, Zustand, Valtio, Jotai, database transactions and outbound patches from CNStra's onDrain. Replace microtask and requestAnimationFrame schedulers with a commit point that matches your actual unit of work, without losing optimistic updates made before an await.
keywords: [state manager batching, store flush, batched updates, optimistic updates, in-memory database, oimdb, mobx reactionScheduler, zustand subscribe, valtio notifyInSync, jotai batching, transaction boundary, commit batch, synchronous batch, event loop turn, reactive store integration, scheduler replacement, batched persistence, coalesced updates]
---

Every batching store has to answer one question: **when is the batch over?**

Without an orchestrator there is no good answer, so stores guess with a
scheduler — a microtask, a `setTimeout(0)`, a `requestAnimationFrame`. Each guess
is a proxy for "probably nothing else is happening right now".

CNStra does not have to guess. It *is* the thing that is happening. `onDrain`
fires exactly when a unit of work has finished everything it can do
synchronously — so the commit point stops being a heuristic and becomes a fact.

```ts
cns.addDrainListener(() => store.commit());
```

That is the whole integration.

## Why this beats a scheduler

| approach | commits when | problem |
| --- | --- | --- |
| microtask | end of the current microtask | fires *inside* a logical unit of work, splitting one reaction into several commits |
| `requestAnimationFrame` | next frame | wrong on the server, and delays optimistic updates by up to a frame |
| `setTimeout(0)` | next macrotask | same, worse |
| **`onDrain`** | **the reaction ran out of synchronous work** | — |

The difference is not just latency. A microtask scheduler has no idea that six
neurons firing in sequence are *one* user action; it will happily commit in the
middle. `onDrain` is aligned with the graph, so one action produces one commit —
and an action that awaits produces exactly one commit per synchronous stretch.

## The boundary

A CNStra run is a sequence of **synchronous turns**. A turn starts when something
feeds the scheduler — the initial `stimulate()`, a settled neuron body, a settled
async listener — and ends when nothing more can run without yielding to the event
loop. `onDrain` fires once at the end of every turn, including the final one.

## OIMDB

The cleanest case, because OIMDB already separates *accumulating* from
*committing*. An `OIMEventQueue` built without a scheduler never flushes itself:

> If not provided, `flush()` must be called manually.

So you simply do not give it one, and let CNStra drive:

```ts
import { OIMEventQueue } from '@oimdb/core';
import { CNS } from '@cnstra/core';

// No scheduler - CNStra is the scheduler.
const queue = new OIMEventQueue();
const cns = new CNS(neurons);

const stopBatching = cns.addDrainListener(() => queue.flush());
```

That replaces `OIMEventQueueSchedulerFactory.createMicrotask()` or
`.createAnimationFrame()` outright. Neurons write to collections exactly as
before; subscribers are notified once per turn instead of once per guess.

### What that buys you

Open a card. Two different collections have to show a spinner, one request goes
out, and both have to fill in when it returns. Five neurons, none of which knows
the others exist:

```ts
// --- turn 1: three independent subscribers of the same signal ---

const cardLoading = neuron({}).dendrite({
    collateral: cardOpened,
    response: p => { cards.upsertOneByPk(p.cardId, { id: p.cardId, loading: true }); },
});

const deckLoading = neuron({}).dendrite({
    collateral: cardOpened,
    response: p => { decks.upsertOneByPk(p.deckId, { id: p.deckId, loading: true }); },
});

const fetcher = neuron({ loaded }).dendrite({
    collateral: cardOpened,
    response: async (p, axon) => {
        const res = await api.load(p.cardId);
        return axon.loaded.createSignal({ ...p, ...res });
    },
});

// --- turn 2: two independent subscribers of the result ---

const applyCard = neuron({}).dendrite({
    collateral: loaded,
    response: p => {
        cards.upsertOneByPk(p.cardId, { id: p.cardId, title: p.title, loading: false });
    },
});

const applyDeck = neuron({}).dendrite({
    collateral: loaded,
    response: p => {
        decks.upsertOneByPk(p.deckId, { id: p.deckId, name: p.name, loading: false });
    },
});
```

Four writes to two collections, split across an `await`. The subscriber sees
exactly **two** frames:

```
card(-, loading=true)              deck(-, loading=true)
card(Hydration, loading=false)     deck(Biology, loading=false)
```

Both spinners appear in the same frame. Both results appear in the same frame.
There is never an intermediate paint with a spinner on one side and data on the
other — and nothing in the code coordinates the two neurons to make that happen.
The turn boundary does it, because the turn *is* the unit of work.

Note where the first frame lands: `cardLoading` and `deckLoading` ran, `fetcher`
started and returned a promise, and the turn ended right there — before
`stimulate()` returned. A commit driven by `queueLength` would have skipped that
frame entirely and painted the spinners only once the request had already come
back, which is to say never.

## What makes a store a good fit

`onDrain` defers **notification**, not **writes**. That distinction decides
whether this recipe helps you at all.

OIMDB fits because the two are already separate: a write lands in the collection
immediately, and `flush()` only broadcasts. A neuron reading the collection later
in the same turn sees everything written before it, and subscribers still hear
about it once.

Anything with that shape works the same way, and the interesting ones are not UI
stores:

```ts
// One database transaction per unit of work
cns.addDrainListener(d => {
    if (!tx.hasWrites()) return;
    tx.commit();
    if (d.queueLength === 0) tx.close();
});

// One outbound patch per turn instead of one per mutation
cns.addDrainListener(() => {
    const patch = journal.drain();
    if (patch.length) socket.send(patch);
});

// One snapshot write per turn
cns.addDrainListener(() => {
    if (state.dirty) persist(state.snapshot());
});
```

## MobX

MobX exposes exactly the same contract as OIMDB, under a different name:

```ts
import { configure } from 'mobx';

let flushReactions: (() => void) | null = null;

// MobX hands us the function that drains its pending reactions instead of
// running it immediately.
configure({ reactionScheduler: run => { flushReactions = run; } });

cns.addDrainListener(() => {
    const run = flushReactions;
    flushReactions = null;
    run?.();
});
```

Observable writes still land immediately, so `runInAction` and read-your-writes
behave exactly as before — only the *reactions* are held until the boundary.
MobX always passes the same internal drain function, which processes its whole
pending queue, so keeping only the latest reference is safe.

Two MobX behaviours to know before you wire this up.

**`configure({ reactionScheduler })` composes, it does not replace.** MobX wraps
the previous scheduler around the new one, so calling `configure` twice stacks
them and reactions end up captured by a scheduler nobody drains. Install it
exactly once at startup — and be careful with HMR, which is the usual way this
gets called twice.

**A reaction's eager first run is deferred too.** With a scheduler installed,
`autorun` does not run on creation; it waits for the next drain. More broadly,
*any* MobX mutation that happens outside a CNStra turn stays queued until some
stimulation drains:

```ts
runInAction(() => { store.n = 5; });
// no reaction has run yet - there was no turn to end
```

That is the real cost of handing MobX's scheduler to CNStra, and it is only an
acceptable trade if CNStra drives essentially all of your MobX activity. If parts
of your app mutate observables outside the graph, keep MobX's default scheduler
and use the notification-interception pattern below instead.

## Stores without a scheduler hook

Zustand, Redux, Valtio and Jotai have no pluggable scheduler, but they all let you
subscribe synchronously. That is enough: intercept the **notification** and
re-broadcast it once per turn. Writes stay immediate, so nothing about
read-your-writes changes.

```ts
// Zustand - store.subscribe fires on every setState
const gate = new EventTarget();
let dirty = false;

useStore.subscribe(() => { dirty = true; });

cns.addDrainListener(() => {
    if (!dirty) return;
    dirty = false;
    gate.dispatchEvent(new Event('change'));
});

// Components read through the gate rather than the store directly:
useSyncExternalStore(
    cb => { gate.addEventListener('change', cb); return () => gate.removeEventListener('change', cb); },
    () => useStore.getState(),
);
```

Redux is the same shape via `store.subscribe`. Valtio needs
`subscribe(state, cb, true)` — its third argument switches notification to
synchronous, otherwise it does its own microtask batching and you are just
layering one scheduler on another.

Jotai is worth a note of its own, because it already solves half the problem.
Its `set` is transactional for *nested* writes: a write atom that performs five
`set` calls notifies subscribers once, and reads inside it see its own writes.
But every top-level `set` opens its own transaction, so a turn in which five
neurons each call `store.set` still produces five notifications.

```ts
const store = createStore();
let dirty = false;
store.sub(someAtom, () => { dirty = true; });

cns.addDrainListener(() => {
    if (!dirty) return;
    dirty = false;
    gate.dispatchEvent(new Event('change'));
});
```

The two layers compose rather than compete: Jotai batches *within* a neuron,
`onDrain` batches *across* them.

Be honest about the payoff here: if your only consumer is React 18+, it already
coalesces renders across a synchronous stretch, so you are unlikely to see a
difference. This pattern earns its keep when the consumer is *not* React — a
worker, a server renderer, a custom view layer, a network sync loop.

(Do not reach for `batch()` from react-redux to do this. As of v9 it is
`@deprecated` and typed as `defaultNoopBatch` — it does nothing.)

## What does not fit: wrapper-only batching

`@preact/signals-core` exports `batch(fn)` and nothing else — `startBatch` and
`endBatch` are internal. A wrapper cannot be split into an open and a close, so
driving it from CNStra would require the engine to run the whole turn *inside* a
caller-supplied function:

```ts
runTurn: turn => batch(turn)   // not implemented
```

CNStra exposes only the end of a turn, so this is currently out of reach. Signals
already batches within a synchronous stretch on its own, which is the same span a
turn covers, so the practical loss is small.

Jotai's `store.set(writeAtom, ...)` is wrapper-shaped in the same way, and could
in principle wrap a whole turn. It is not worth doing: the neurons inside would
have to reach for the transaction-scoped `set` instead of calling `store.set`
normally, which leaks the batching strategy into every dendrite. Intercepting the
notification, as above, keeps neurons unaware of it.

## Rule of thumb

If committing in your store is a separate, explicit and somewhat expensive
operation, `onDrain` tells you exactly when to do it. If it is not, check whether
you can intercept the notification instead. If neither is available, you probably
do not have the problem this solves.

## Why not `queueLength === 0`

Because it does not mean what it looks like it means.

`queueLength === 0` marks the **terminal response** — the run is over. It does not
mark a batch boundary, and the difference is not academic:

```ts
neuron({ userLoaded }).dendrite({
  collateral: userClicked,
  response: async (payload, axon) => {
    db.users.setLoading(payload.id, true);   // synchronous write
    const user = await fetch(`/users/${payload.id}`);
    return axon.userLoaded.createSignal(user);
  },
});
```

The turn ends the moment this body reaches its `await`. `setLoading(true)` is
already in the store. But responses are emitted when an activation *finishes*,
and this one has only *started* — so no response is emitted at that moment, and a
commit driven by `queueLength` would not run until `fetch` settles.

The spinner never appears. The UI jumps straight from the old state to the loaded
state. Optimistic updates, skeletons and disabled buttons all break the same way.

With `onDrain` the commit happens in the same tick as the click, before
`stimulate()` even returns.

## Reading the payload

```ts
cns.addDrainListener(d => {
  queue.flush();

  if (d.queueLength === 0) {
    // Nothing pending, nothing in flight: this run is finished.
    analytics.track('run_complete');
  }
});
```

| field | meaning at drain time |
| --- | --- |
| `queueLength` | `pendingActivations + activeActivations`. Zero means the run is finished. |
| `pendingActivations` | Bodies not yet invoked. Non-zero **here** means *blocked* — by a concurrency limit or an abort — never "about to run". |
| `activeActivations` | Bodies awaiting an unsettled promise. Non-zero means another drain is coming. |

The counters are the same as on a response, but measured *after* the scheduler
loop exhausted rather than before the work runs — so on a drain they are facts,
not forecasts.

## Things to get right

### Make the commit cheap when nothing changed

`onDrain` fires on every turn, and nested stimulations fire their own. A commit
with an empty buffer must be a no-op — every example above returns early for
exactly this reason.

This also handles re-entrancy: if the commit renders, and the render calls
`cns.stimulate()`, that nested stimulation announces its own boundary inline and
commits again. That is correct — and free, because the buffer is already empty.

### Do not gate on the whole organism being idle

It is tempting to keep a counter of live stimulations and commit only when it
hits zero. Don't: one long-running stimulation waiting on a slow request would
freeze the UI for everything else. Commit per batch. That is the aggressive
option and the right one.

### Handle abort separately

An aborted stimulation stops without further responses, and its last drain
reports `pendingActivations > 0` with nothing that will ever run it. If a final
commit matters on that path, pair it with the completion promise:

```ts
const stim = cns.stimulate(signal, {
  abortSignal: controller.signal,
  onDrain: () => queue.flush(),
});
stim.waitUntilComplete().catch(() => queue.flush());
```

The promise is created lazily, so runs that pass no `abortSignal` do not pay for
it.

### `onDrain` is synchronous

It returns `void` and a returned promise is **not** awaited. There is nothing to
gate on — the next turn is started by someone else's promise settling, so
awaiting here would only delay the commit. For asynchronous work at a boundary,
use `onResponse`, which does support promises.

A listener that throws is logged and isolated; it cannot derail the stimulation
or the other listeners.

### Coalescing across turns is your call, not the core's

The default — flush inline on every drain — commits before `stimulate()` returns,
which is what you want for a snappy, sync-first UI. If instead you would rather
collapse several turns in the same tick into one flush, that is an adapter-side
decision: mark dirty on the drain and flush on a trailing microtask.

```ts
let scheduled = false;
cns.addDrainListener(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; queue.flush(); });
});
```

You trade "committed before `stimulate()` returns" for one flush instead of
several — sensible if the flush is expensive and several independent
stimulations fire in the same tick. Note what it takes to even reach that case:
*separate* stimulations, because one signal's synchronous cascade is always a
single turn. If you are seeing a pile of turns per tick, that is usually a sign
something is calling `stimulate()` imperatively where one signal would do — the
core defaults are right for the common case, so reach for this only when you have
measured a reason to.

### Neuron-level concurrency splits batches

`setConcurrency(n)` on a neuron forces activations past the limit onto a promise,
even when the dendrite body is synchronous. Those activations land in the next
turn, so a gated neuron produces more batches than an ungated one. This is
expected — the gate is a scheduling boundary — but it is worth knowing when a
render count looks higher than the graph suggests.

## Verified against

Every integration on this page is covered by executable tests in
`packages/integration-tests`, against the real libraries:

| store | version | what is pinned |
| --- | --- | --- |
| OIMDB | 3.10.0 | a queue with no scheduler never flushes itself; one flush per turn; the two-collection example above, frame for frame |
| MobX | 6.16.1 | one reaction run per turn; the two caveats above |
| Jotai | 2.20.2 | one notification per turn; `set` transactional for nested writes |
| Zustand | 5.0.14 | three `setState` calls → one gated notification |
| Valtio | 2.3.2 | one gated notification; `notifyInSync` really is required |
| Redux | 5.0.1 | three dispatches → one gated notification |

Each also asserts read-your-writes inside a turn, and the optimistic-write-before-
`await` case that motivates the whole recipe. If you change the wiring, run them.

## See also

- [`onDrain` API reference](../core/api.md#batch-boundaries-ondrain) — the six ways a turn can end, and why a response cannot express the boundary
- [Response listeners](./response-listeners.md) — per-signal observation, backpressure metrics
