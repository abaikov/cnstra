# @cnstra/oimdb

The OIMDB binding of the [`@cnstra/sync`](../sync) homeostat: a query is an OIMDB computed, and its record lives in an OIMDB collection. Full guide: [Sync (homeostat)](../../docs/frontend/sync.md).

```sh
npm install @cnstra/oimdb @cnstra/sync @cnstra/core @oimdb/core
```

`@cnstra/sync` and `@oimdb/core` are peer dependencies, and `@cnstra/core` is the peer of `@cnstra/sync`: one copy of each in the app, shared with your own graph and database.

| export | what it is |
|---|---|
| `createCNSOIMDBHomeostatEnvironment({ db, cns, onlineSlot?, visibilitySlot?, … })` | the environment with defaults; every part can be replaced: `homeostatFiringPolicy`, `createHomeostatCorrectionRepository`, `createHomeostatRegulator`, `createHomeostatRefetchPolicy`, `stimulationOptionsOf`, `keyHashFn`, `getNowMs` (default the db clock, which the refetch wheel uses too), `runUntracked`, `runInTransaction`, `runWrite`, `scheduleRefetchAt` (default a slot wheel on the db clock that hands over every due key, a held one nobody reads included: that key is marked stale and asked when it is read again), `homeostatCorrectionStoreSlotOptions`, `staleTimeMs`, `homeostatRefractoryPolicy`, `stimulationOptions` |
| `CNSOIMDBHomeostatEnvironment` | `createComputedStoreAggregate(receptor)` — the store aggregate of one computed per key (`TCNSOIMDBHomeostasisComputedStoreAggregate<TKey>`) (`getSlotByKey(key).value`; `storeSlot` for `@oimdb/react`); `createSourceTrackingComputedStoreAggregate(receptor, { getHomeostatSource() → { key, transduce } \| undefined })` — `getSingleSlot().value` (`TCNSOIMDBHomeostasisSourceTrackingComputedStoreAggregate<TKey>`); `createReceptiveField(receptor, { selectKey(slotKey), isSlotDemanded?(slot) })` → `CNSOIMDBHomeostatReceptiveField` — pass its `slotSubscriptionListener` to a domain collection and each read slot asks the receptor for `selectKey(slot.key)`; `isSlotDemanded` (every read slot by default) is asked once per first reader, after the flush, with the entity slot — `false` asks nothing, e.g. `slot => slot.entity === undefined` for cards a bucket answer wrote; `homeostasisComputedStoreAggregate` gives the loading and the error of a key; `invalidate(receptor, key)` → promise of the refreshed value; `dispose()` — aborts the running requests, stops the refetch wheel and disposes the effects of its receptive fields; for a db per request or test call `homeostatEnvironment.dispose(); db.dispose();` |
| `CNSOIMDBHomeostatCorrectionRepository` / `ICNSOIMDBHomeostatCorrectionRepository`, `createCNSOIMDBHomeostatCorrectionStoreSlot(db, options?)` | records on an OIMDB collection keyed by the key hash; the queries hold a record's slot and the collection's `slotReleasePolicy` decides when it goes after the last one — `OIMSlotAtUnholdReleasePolicy` by default (at once), `new OIMSlotAfterUnholdReleasePolicy({ keepAfterUnholdMs })` through `homeostatCorrectionStoreSlotOptions` to keep it for a window |
| `CNSOIMDBHomeostatFiringPolicy` / `ICNSOIMDBHomeostatFiringPolicy` | `CNSHomeostatFiringPolicy` of `@cnstra/sync` over `{ isOnline }` / `{ isVisible }` slots, plus the `sourceSlots` a query reads |
| `TCNSOIMDBHomeostatCNS` | the `cns` the factory takes: `stimulate` and `batch`, as a `CNS` has them |
| `createCNSOIMDBRunOutsideFlush(channelSlot, cns)` | one queue run after the current flush (one subscription per flush) or in one microtask outside it, inside one `cns.batch`, so the drains of its stimulations commit once |

Commit through the graph: `cns.addDrainListener(() => db.flush())`, the one commit point OIMDB documents for cnstra. Every write of the binding goes through a stimulation — answers, failures, a stale record after `staleTimeMs` or `invalidate` (`homeostasisDisturbed`) — and the stimulations of one answer batch or one refetch pass run inside one `cns.batch`, so they commit once. `@oimdb/browser` writes `onlineSlot` and `visibilitySlot` from window events, outside the graph: give its services `onBrowserEntityWritten: () => db.flush()` (`@oimdb/browser` 1.3.0), so going back online or visible commits at once.

Requires `@oimdb/core` 4.11.0.
