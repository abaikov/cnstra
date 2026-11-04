# @cnstra/mobx

```sh
npm install @cnstra/mobx @cnstra/sync @cnstra/core mobx
```

`@cnstra/sync` and `mobx` are peer dependencies, and `@cnstra/core` is the peer of `@cnstra/sync`: one copy of each in the app.

The MobX binding of the [`@cnstra/sync`](../sync) homeostat: a query is a MobX `computed`, its record lives in an `observable.map`, and the request is released by `onBecomeUnobserved`.

```ts setup
import { autorun, observable, runInAction } from 'mobx';
import { CNS, neuron } from '@cnstra/core';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { createCNSMobXHomeostatEnvironment } from '@cnstra/mobx';

type TDeck = { id: string; title: string };
declare function fetchDeck(deckId: string, abortSignal: AbortSignal): Promise<TDeck>;
declare function renderDeck(deck: TDeck): void;
declare function renderError(error: unknown): void;
declare function renderSpinner(): void;
const decks = observable.map<string, TDeck>();
const online = observable.box(true);
const selectedDeckId = observable.box<string | undefined>(undefined);
```

```ts
const deckHomeostatReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({ name: 'deck', staleTimeMs: 30_000, transduce: ([deckId], abortSignal) => fetchDeck(deckId, abortSignal) });
const homeostatReceptorCorrection = new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckHomeostatReceptor] });
const deckWriter = neuron({}).dendrite({
    collateral: deckHomeostatReceptor.axon.homeostasisRestored,
    response: ({ key: [deckId], data }) => { runInAction(() => decks.set(deckId, data)); },
});
const cns = new CNS([deckHomeostatReceptor.neuron, homeostatReceptorCorrection.neuron, deckWriter]);
const homeostatEnvironment = createCNSMobXHomeostatEnvironment({ cns, isOnline: () => online.get() });

const deckHomeostasis = homeostatEnvironment.createComputed(deckHomeostatReceptor, ['d1']);
autorun(() => {
    const deck = decks.get('d1');
    if (deck !== undefined) renderDeck(deck);
    else if (deckHomeostasis.get().status === ECNSHomeostatCorrectionStatus.Failed) renderError(deckHomeostasis.get().error);
    else renderSpinner();
});

const selectedDeckHomeostasis = homeostatEnvironment.createSourceTrackingComputed(deckHomeostatReceptor, {
    getHomeostatSource: () => {
        const deckId = selectedDeckId.get();
        return deckId === undefined ? undefined : { key: [deckId], transduce: abortSignal => fetchDeck(deckId, abortSignal) };
    },
});
```

`isOnline` and `isVisible` must read a MobX observable, like `online` above: a query reads them inside its computed, so `() => navigator.onLine` is read once, and a query paused offline never fires again. Keep the browser value in an `observable.box` and set it from the `online`, `offline` and `visibilitychange` events.

| export | what it is |
|---|---|
| `createCNSMobXHomeostatEnvironment({ cns, isOnline?, isVisible?, … })` | the environment with defaults; every part can be replaced: `homeostatFiringPolicy`, `createHomeostatCorrectionRepository`, `createHomeostatRegulator`, `createHomeostatRefetchPolicy`, `stimulationOptionsOf`, `keyHashFn`, `getNowMs`, `runUntracked` (default one microtask per batch, run inside one `runInAction`), `runInTransaction` (default `runInAction`), `runWrite`, `scheduleRefetchAt` (default one `setTimeout` per refetch slice of `CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS` from `@cnstra/sync`, firing at the slice end as the OIMDB wheel does, cancelled when the last reader leaves), `staleTimeMs`, `homeostatRefractoryPolicy`, `stimulationOptions` |
| `CNSMobXHomeostatEnvironment` | `createComputed(receptor, key)` — the same computed for a key while it is observed, so it may be called on every render; `createSourceTrackingComputed(receptor, { getHomeostatSource })` — `() => { key, transduce } | undefined`, create once; `invalidate(receptor, key)` → promise of the refreshed value; `dispose()` — aborts the running requests and clears the refetch timers; a computed read after it returns its last value and starts nothing |
| `createCNSMobXHomeostatSchema({ homeostatModels, neuronFactories, homeostatEnvironmentOptions? })` | the models of `defineCNSHomeostatModel` from `@cnstra/sync` on MobX, the same as `createCNSOIMDBHomeostatSchema` on OIMDB (`neuronFactories` a record of named factories, the built neurons under the same names as `neurons`): `collections[name].getEntry(id)` / `writeEntry(id, entity)`, `buckets[receptor][collection].getEntities(key)`, `summaries[receptor].getEntry(key)`, `homeostasis[receptor].createComputed(key)`, and `peekEntry` / `peekEntities` to read without observing; an equal write notifies nobody, and the first reaction observing an entry holds the receptor's key (`createReceptiveField` of the environment) until the last one leaves; an entry no reaction observes and no bucket entry holds (`holdEntry` / `unholdEntry`, `TCNSMobXHomeostatEntryMemberHold`) is dropped `keepAfterIdleMs` after it became idle, by one timer per idle entry (a microtask for `0`) |
| `CNSMobXHomeostatCorrectionRepository({ keepAfterUnholdMs? })` / `TCNSMobXHomeostatCorrectionRepositoryOptions` | records in an `observable.map`, by key hash; counts the environments holding a key, deletes a record in a microtask after the last one leaves, or after `keepAfterUnholdMs` (one timer per released key, re-armed past `2 ** 31 - 1` ms, none with `Infinity`); a record written into a key nobody holds goes the same way |

Read a query inside a reaction (`autorun`, `reaction`, `observer`). A query read outside one, or inside an action before a reaction observes it, holds its key until a reaction observes and drops it. The computeds are created with `requiresReaction`: MobX warns about such a read in development builds, outside a batch.
