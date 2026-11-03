---
id: sync
title: Syncing OIMDB with a Server — Homeostat
sidebar_label: Sync (homeostat)
slug: /frontend/sync
description: Keep local data equal to the server with CNStra. A query runs its request in the state manager's reactive layer, a correction neuron writes the answers, and a receptive field asks for the slots a screen reads.
---

`@cnstra/sync` holds the rules and is the same for every state manager; `@cnstra/oimdb` binds them to OIMDB, `@cnstra/mobx` to MobX.

```sh
npm install @cnstra/sync @cnstra/oimdb @cnstra/core @oimdb/core @oimdb/browser
```

```ts setup
import { CNS, cnsNeuron, cnsNeuronFactory } from '@cnstra/core';
import { CNSHomeostatBatchTransducer, CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, CNSHomeostatReceptorFetch, CNSHomeostatTransductionEndpoint, CNSHomeostatTransductionFetch, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import type { TCNSHomeostasisState, TCNSHomeostatTransductionRow } from '@cnstra/sync';
import { createCNSOIMDBHomeostatEnvironment } from '@cnstra/oimdb';
import type { TCNSOIMDBHomeostatCNS } from '@cnstra/oimdb';
import { OIMDB, createOIMEntitySlotCollectionStoreAggregate } from '@oimdb/core';
import { createOIMBrowserOnlineSingleSlotService, createOIMBrowserVisibilitySingleSlotService } from '@oimdb/browser';

type TDeck = { id: string; title: string };

declare let deckHomeostasis: TCNSHomeostasisState<[deckId: string]>;
declare const deckId: string;
declare const draft: TDeck;
declare function fetchDeck(deckId: string, abortSignal: AbortSignal): Promise<TDeck>;
declare function parseDeck(value: unknown): TDeck;
declare function saveDeck(deck: TDeck): Promise<void>;
declare function renderDeck(deck: TDeck): void;
declare function renderError(error: unknown): void;
declare function renderOffline(): void;
declare function renderSpinner(): void;
declare function showError(error: unknown): void;
declare function closeDialog(): void;
```

## Queries: a receptor, a regulator, a binding

A query runs its request in the state manager's reactive layer; CNStra only hears what happened. The code that decides — fire, pause, idle, join the running request of the key, settle, release — is `CNSHomeostatRegulator` in `@cnstra/sync` and is the same for every state manager. A binding gives it three things: where records live, how to run after the current derivation, how to batch writes. `@cnstra/oimdb` binds it to OIMDB, `@cnstra/mobx` to MobX.

Three axes:

- **definition** — `CNSHomeostatReceptor` (name, `transduce`, `staleTimeMs`, `homeostatRefractoryPolicy`, `stimulationOptions`) and `CNSHomeostatReceptorCorrection` (the neuron that writes answers). Part of the static graph; knows no database and no CNS instance.
- **environment** — one per state manager instance and CNS: records per receptor, the firing policy (network, visibility or your own), the refetch scheduler, key identity, the clock, defaults for receptors. Made by a factory; every part is an option.
- **query** — a computed of the binding: by key, or source-tracking with its own `getHomeostatSource`.

```ts setup shown
const deckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
    name: 'deck',
    staleTimeMs: 30_000,
    transduce: ([deckId], abortSignal) => fetchDeck(deckId, abortSignal),
});
const homeostatCorrection = new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] });

const createDeckSchema = (db: OIMDB) => {
    const decks = createOIMEntitySlotCollectionStoreAggregate<TDeck>(db);
    const selection = createOIMEntitySlotCollectionStoreAggregate<{ deckId: string }>(db);
    const deckWriter = cnsNeuron({}).dendrite({
        collateral: deckReceptor.axon.homeostasisRestored,
        response: ({ key: [deckId], data }) => { decks.writeSlotContentByKey(deckId, data); },
    });
    return { decks, selection, deckWriter };
};
const createHomeostatSchema = (db: OIMDB, cns: TCNSOIMDBHomeostatCNS) => {
    const onlineService = createOIMBrowserOnlineSingleSlotService({ onBrowserEntityWritten: () => db.flush() });
    const visibilityService = createOIMBrowserVisibilitySingleSlotService({ onBrowserEntityWritten: () => db.flush() });
    const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({
        db,
        cns,
        onlineSlot: onlineService.getSingleSlot(onlineService.createStoreSlot(db)),
        visibilitySlot: visibilityService.getSingleSlot(visibilityService.createStoreSlot(db)),
    });
    return { homeostatEnvironment, deckQueries: homeostatEnvironment.createComputedStoreAggregate(deckReceptor) };
};
const createAppDB = () => new OIMDB({
    createSchemas: (db) => {
        const deck = createDeckSchema(db);
        const cns = new CNS([deckReceptor.neuron, homeostatCorrection.neuron, deck.deckWriter]);
        cns.addDrainListener(() => db.flush());
        return { deck, homeostat: createHomeostatSchema(db, cns) };
    },
});

const db = createAppDB();
const { decks, selection } = db.schemas.deck;
const { deckQueries, homeostatEnvironment } = db.schemas.homeostat;
```

The receptors and the correction neuron hold no database and stay in the module. The writer, the CNS and the environment belong to one database, so they are built in `createSchemas`; a test or a server request calls `createAppDB()` again and gets its own. To drop such a database, dispose the environment first, then the database:

```ts
homeostatEnvironment.dispose();
db.dispose();
```

`homeostatEnvironment.dispose()` aborts every running request (its answer is `homeostasisCancelled`, and nothing is written), stops the refetch wheel, disposes the effects of its receptive fields and releases every held key as when its last reader leaves: a pending `invalidate` resolves with `undefined` and the correction repository is told the key is unheld — a repository that keeps records after unhold keeps them, and in MobX its timers, for its window. `waitUntilSettled()` of an aborted request rejects with the abort reason. After it, a read returns the last value or `Idle` and starts nothing, `invalidate` resolves with `undefined` and `invalidateByKeyPrefix` with `[]`, without a write. `db.dispose()` then stops the timers of OIMDB.

The environment takes a `cns` and a `db` and nothing else, so any way of giving your neurons the database fits it. Three common ones, all with no cost per stimulation:

- **a closure** (the setup above, recommended): a function builds the writers over one database and the CNS from them; with each neuron a factory in its own file, `createCNS(neuronFactories, db)` from `@cnstra/core` calls them all with the database and checks its type against each of them.
- **`global`**: the neurons are built once, typed with `cnsNeuronFactory().withGlobal<T>()`, and each database gets its own `new CNS(neurons, undefined, global)`; a dendrite reads `ctx.global`. The type is checked in the dendrite only: `new CNS` takes `global` as `unknown`.
- **one database for the app**: build the database, the neurons and the CNS once in a module.

```ts
const { neuron } = cnsNeuronFactory().withGlobal<ReturnType<typeof createDeckSchema>>();
const globalDeckWriter = neuron({}).dendrite({
    collateral: deckReceptor.axon.homeostasisRestored,
    response: ({ key: [deckId], data }, _axon, { global }) => { global.decks.writeSlotContentByKey(deckId, data); },
});
const deckNeurons = [deckReceptor.neuron, homeostatCorrection.neuron, globalDeckWriter];
const createGlobalAppDB = () => new OIMDB({
    createSchemas: (db) => {
        const deck = createDeckSchema(db);
        return { deck, homeostat: createHomeostatSchema(db, new CNS(deckNeurons, undefined, deck)) };
    },
});
```

The closure and `global` both make a CNS per database: its concurrency and rate limits count per database, and devtools and persist see one app per database. Several users in one process (server-side rendering) need one `CNSHomeostatBatchTransducer` per user or per request, like the CNS: a transducer in a module joins the keys of every database that asks in the same macrotask into one request with one set of credentials.

### Loading and the result

The query gives the status, the domain slot gives the data. Read both in one effect: the correction neuron and the writer run in one stimulation (inside one transaction of the state manager), so the frame that sees `Restored` already has the data.

```ts
db.createEffect(() => {
    const deckHomeostasis = deckQueries.getSlotByKey(['d1']).value;
    const deck = decks.getSlotByKey('d1').entity;
    if (deck !== undefined) renderDeck(deck);
    else if (deckHomeostasis.status === ECNSHomeostatCorrectionStatus.Failed) renderError(deckHomeostasis.error);
    else if (deckHomeostasis.status === ECNSHomeostatCorrectionStatus.Paused) renderOffline();
    else renderSpinner();
});
```

`TCNSHomeostasisState { key, status, firingNumber, error, homeostatRunningFiring }`; `status` is `Idle`, `Firing`, `Paused`, `Restored` or `Failed`; `homeostatRunningFiring` is the running request while `Firing`, `undefined` otherwise. `error` is the last failure of the key: set on `Failed`, and kept on `Firing` and `Paused` while the key is asked again after a failure (a refractory retry, an `invalidate`, a reader that comes back while the record is kept), so a screen can tell «first load» from «retrying after an error»; a `Restored` answer clears it. On a `Firing` or `Paused` value it is the error at the moment the value was made.

- Every answer, a refetch's too, goes through your writer: a writer that writes a new object for an answer equal to the data it has makes the screen render again. Skip an equal answer in the writer when that render matters.
- On OIMDB the first subscriber fires: a read only works out the value (`Firing` when the key needs a request), and the request starts when an effect, a hook or a receptive field first subscribes to the query's slot — so a render React throws away, or reads before it subscribes, sends nothing. A read with no subscriber (a loader) subscribes with `db.createEffect`, as below; a hold alone (`holdSlotByKey`, `useOIMSlotsByKeys`) starts nothing. On MobX the first read inside a reaction fires. One store aggregate of `createComputedStoreAggregate` has one query per key, and MobX `createComputed(receptor, key)` returns the same computed for a key while it is observed — calling it on every render is safe. Readers of the same key share one request; it is aborted when its last holder leaves (`homeostasisCancelled`, nothing written).
- `homeostatFired` and the answer are stimulated after the derivation, so a dendrite on them may write the state manager. A record goes `Stale` through a stimulation too, `homeostasisDisturbed`, when its `staleTimeMs` passes or on `invalidate`: every write of the homeostat is a stimulation, so the drain listener is its one commit point. On OIMDB the answers of one batch and the refetches of one pass of the wheel run inside one `cns.batch(run)`, which announces the drains of the stimulations started in it when it ends: one frame for the batch; MobX gets the same from `runInAction`.
- A record lives while any query holds its key. When the last one leaves, the repository decides how long the record stays: by default it goes at once and the next read asks again. Keep it for a window — `homeostatCorrectionStoreSlotOptions: { slotReleasePolicy: new OIMSlotAfterUnholdReleasePolicy({ keepAfterUnholdMs: 300_000 }) }` on OIMDB, `createHomeostatCorrectionRepository: () => new CNSMobXHomeostatCorrectionRepository({ keepAfterUnholdMs: 300_000 })` on MobX — and a reader that comes back to a key nobody holds, while its `Restored` record is kept and not yet stale, is answered from the record without a request. Without a `staleTimeMs` a `Restored` record never goes stale by time: it answers every reader until `invalidate`. A kept `Failed` record is asked again at once. A reader that joins a key another query holds is answered from a fresh `Restored` record the same way. The record does not know whether the data is still in the domain slot: after you drop the data, `invalidate(receptor, key)` marks the kept record stale.
- `Restored` goes stale after `staleTimeMs` (never without one; it must be above 0 — `0` would refetch as fast as the answers come, and is refused, as is a `homeostatRefractoryPolicy` with `initialDelayMs` 0); a `Failed` key with a `homeostatRefractoryPolicy` is asked again after the delay — only while held, and only when the firing policy allows (online and visible by default). `homeostatRefractoryPolicy` is `{ initialDelayMs, multiplier, maxDelayMs, jitter? }`: after the attempt `n` the delay is `min(maxDelayMs, initialDelayMs × multiplier^(n − 1))`, shortened by up to `jitter` of itself (from 0 to 1, 0 by default; outside that range it is refused), so clients that failed together do not ask again together. The share is drawn from the failure itself, so every read of the same failure sees the same refetch time. A first read fires while hidden; offline it is `Paused` and fires when the network comes back; a running request is not aborted when the network drops.
- `CNSHomeostatReceptorFetch` and `CNSHomeostatTransductionFetch` give every request 30 seconds by default: a request that does not answer by then fails with a `TimeoutError` whose message is `GET url: timed out after 30000 ms`, so its key is `Failed` and the refractory policy asks again. Change it with `timeoutMs` (above 0); `timeoutMs: Infinity` turns it off; above 2147483647 ms a timer cannot wait and is refused. Both use `AbortSignal.any` (Node 20.3, Safari 17.4 and later). A `transduce` of your own has no deadline: a request that never answers keeps its key `Firing` until its last reader leaves, and an `invalidate` meanwhile waits for it, so give its `fetch` the signal `AbortSignal.any([abortSignal, AbortSignal.timeout(30_000)])`.
- A writer that fails on `homeostasisRestored` — throws, or returns a promise that rejects — fails the key. The regulator waits for the stimulation of every `Restored` answer; when it fails, the regulator stimulates `homeostasisFailed` for the same request with the error `waitUntilComplete()` rejected with, the correction neuron writes the record `Failed` through `reduceHomeostatCorrectionState`, the queries show `Failed`, a neuron on `homeostasisFailed` hears it, and the refractory policy asks again. What the writer wrote before it failed stays in the domain slot. `waitUntilSettled()` and `invalidate` of that request still reject with the stimulation's error.
- `invalidate` faster than a round trip keeps the key `Firing`: the answer of each request that started before the last invalidate is cancelled and asked again, so no writer gets data until a request outlives the last invalidate; every `invalidate` of the storm then resolves with that answer.
- `homeostatEnvironment.invalidate(deckReceptor, ['d1'])` marks the key stale — a refresh after a write. The record carries an `invalidationNumber`; `invalidate` raises it, and a request remembers it when it starts. An answer to a request that started before the last invalidate may hold data from before the write, so it is not delivered: the regulator stimulates `homeostasisCancelled` instead of `homeostasisRestored` (no writer runs), stimulates `homeostasisDisturbed`, on which the correction neuron writes the record `Stale` for that request, and the queries ask again at once — whichever environment on the same repository sent that request. A failure of such a request still goes out as `homeostasisFailed` and counts as an attempt; its record is written `Stale`, so it is asked again at once. Order is kept per receptor and key only, so one entity that arrives through two receptors — a deck in a list and in its detail — needs a version from the server (`updatedAt`) that its writer compares before it writes. `invalidate` returns a promise of the value of the first request started after it whose answer is delivered — `Restored`, or `Failed` with its `error` — resolved once the stimulation of that answer has completed, so every dendrite on it, an async domain writer included, has run. It resolves `undefined` at once when no query holds the key and when the last one leaves before the refresh answers; it waits while the key cannot be asked (offline); a hidden tab does not hold an invalidated key back, as it holds back a stale-time refetch; it rejects when a dendrite on that answer fails.
- `homeostatEnvironment.invalidateByKeyPrefix(receptor, ['d1'])` invalidates every key the queries of the receptor hold whose leading parts are the prefix — for a receptor keyed `[deckId, page]`, `['d1', 1]` and `['d1', 2]`, not `['d2', 1]`; `[]` takes every held key. A held key matches when `keyHashFn` of its first `prefix.length` parts equals `keyHashFn(prefix)`, so a `keyHashFn` of your own decides here too. It returns a promise of an array with the value `invalidate` gives for each matching key, `[]` when none matches. Unlike `invalidate`, it touches held keys only: a record kept after its last reader left is not touched — the repository cannot list its records — so a reader who comes back to it is answered from it; `invalidate(receptor, key)` marks one such record.
- An answer older than the record is dropped; an answer without the regulator's stimulation context (a resumed run) writes nothing.

### Waiting for the answer

`deckHomeostasis` is a value the query gave, as in the effect above:

```ts
const settled = await deckHomeostasis.homeostatRunningFiring?.waitUntilSettled();
```

- `waitUntilSettled()` resolves with the settled value — `Restored`, or `Failed` with its `error` — once the stimulation of the answer has completed, so every dendrite on it, the domain writer included, has run. Readers that share the request share one promise; it is made on the first call.
- It rejects with the abort reason when the request is aborted before its answer — its last reader left, or its readers moved on to a new request (a changed key, a newer stale record, an `invalidate` after it started) — and with the stimulation's error when a dendrite on the answer fails; the key then goes `Failed`. The abort reason is an `AbortError` whose message names the cause: `homeostat request released` when its last reader left, `homeostat request disposed` after `dispose()`.
- Do not await it inside a dendrite on the answer: the stimulation it waits for includes that dendrite.
- After it resolves, the OIMDB query's value changes on the next flush, the MobX query's at once.
- The data of a request invalidated while it runs is not delivered: its readers move to the next request, a new `homeostatRunningFiring` on the next `Firing` value, and its wait rejects with the abort reason; a failure of it resolves with `Failed`. Await the promise `invalidate` returned instead.

### In an app

```ts
// a retry button, or a save that closes its dialog once the fresh data is shown
await saveDeck(draft);
const refreshed = await homeostatEnvironment.invalidate(deckReceptor, [draft.id]);
if (refreshed?.status === ECNSHomeostatCorrectionStatus.Failed) showError(refreshed.error);
closeDialog();

// a route loader: start the query, wait for the data, let the page take the query over
const stopLoader = db.createEffect(() => {
    deckHomeostasis = deckQueries.getSlotByKey([deckId]).value;
});
await deckHomeostasis.homeostatRunningFiring?.waitUntilSettled();
// mount the page (it reads the same slot), then
stopLoader();
```

- Commit OIMDB through the graph, `cns.addDrainListener(() => db.flush())`, as in the setup above; without a commit point queries see records only when you call `db.flush()` and these promises wait for it.
- Sign-in and sign-out: the `headers` of `CNSHomeostatReceptorFetch` and `CNSHomeostatTransductionFetch` are fixed when they are built, so a token that changes goes through a `fetch` of your own. On sign-out call `homeostatEnvironment.dispose()` and build a new database: `dispose` aborts the running requests, so no answer for the old user is written, and a record kept after unhold would otherwise answer the next user's reader without a request.
- Create the store aggregates of the queries once — in `createSchemas` or a store — not per render; only MobX `createComputed(receptor, key)` may be called per render.
- The page takes the loader's query over without a second request when it reads the same slot (OIMDB) or the same key (MobX) before the loader lets go. A query that mounts on its own after the last one left asks again unless its record is kept and fresh (see «Loading and the result»); the domain slot still has the data, so the page shows it while the request runs.
- The retry and the save run on both bindings in `packages/sync/src/tests/conformance/cnsHomeostatConformance.ts`; the loader hand-over, which rests on how each binding shares a query (the same slot in OIMDB, the same computed in MobX), in `packages/oimdb/src/tests/CNSOIMDBHomeostatUseCases.test.ts` and `packages/mobx/src/tests/CNSMobXHomeostatUseCases.test.ts`.

### A source-tracking query

```ts
const selectedDeckQuery = homeostatEnvironment.createSourceTrackingComputedStoreAggregate(deckReceptor, {
    getHomeostatSource: () => {
        const deckId = selection.getSlotByKey('current').entity?.deckId;
        return deckId === undefined ? undefined : { key: [deckId], transduce: abortSignal => fetchDeck(deckId, abortSignal) };
    },
});
db.createEffect(() => {
    const selectedDeckHomeostasis = selectedDeckQuery.getSingleSlot().value;
    if (selectedDeckHomeostasis.status === ECNSHomeostatCorrectionStatus.Failed) renderError(selectedDeckHomeostasis.error);
});
```

- `getHomeostatSource()` reads what the request depends on (on OIMDB a read of `slot.entity` or `computed.value` inside it is a source, as in any OIMDB derive) and returns its source: the receptor's whole key (`[deckId]`, `[deckId, page]`) and the request. The key and the request come from one read. The returned object is the computed's value as is; the key hash is computed once per new key object and kept on the query — return a new key array when the key changes, never mutate the old one.
- `undefined` — not ready yet: the query is `Idle`, its value carries `key: undefined`, and nothing is sent to the graph. A throw in `getHomeostatSource` reaches the reader of the computed like any computed error.
- A change of the key aborts the running request of the old key and runs one for the new key. A change of anything else it read keeps the running request: one request per key at a time; the new `transduce` serves the next request of the key, and a `Failed` query asks again with it — at once, or after its refractory delay when the receptor has a `homeostatRefractoryPolicy`. The answer arriving changes nothing it read.
- Queries whose sources have one key share the request and the record.

### A receptive field: a read slot asks its receptor

The slots a screen reads are the receptive field of a receptor: a slot that gets its first reader is asked for, with no query in the screen.

```ts
const deckReceptiveField = homeostatEnvironment.createReceptiveField(deckReceptor, { selectKey: (deckId: string): [deckId: string] => [deckId] });
const syncedDecks = createOIMEntitySlotCollectionStoreAggregate<TDeck>(db, {
    slotSubscriptionListener: deckReceptiveField.slotSubscriptionListener,
});

db.createEffect(() => {
    const deck = syncedDecks.getSlotByKey('d1').entity;
    const deckHomeostasis = deckReceptiveField.homeostasisComputedStoreAggregate.getSlotByKey(['d1']).value;
    if (deck !== undefined) renderDeck(deck);
    else if (deckHomeostasis.status === ECNSHomeostatCorrectionStatus.Failed) renderError(deckHomeostasis.error);
    else renderSpinner();
});
```

- A slot that gets its first reader joins the demand; after the flush (or in one microtask outside a flush) the field holds the query of `selectKey(slot.key)` with one effect per key — so everything a query does applies: one request per key, shared with queries of the same key; the refractory retry; the refetch after `staleTimeMs` while the slot is read; `invalidate`; the abort when the last slot of the key loses its last reader (the field lets the query go on its next pass, after the flush or in one microtask — a reader that leaves and another that comes in the same tick keep the request). A slot whose reader left before the flush ended asks nothing. A read column slot counts for its entity.
- The loading and the error of a key are the value of the field's query: `homeostasisComputedStoreAggregate.getSlotByKey(key).value`, or `useOIMComputedValueByKey(deckReceptiveField.homeostasisComputedStoreAggregate.storeSlot, key)` in React. Reading it holds the same query — no second request.
- A slot of a composite key maps to the receptor's key in `selectKey`; a key part is a string, a number or `undefined`, so the first page is `['d1', undefined, 20]`. A collection of such keys takes `new OIMSlotTreeStoreService<TOIMStoreKey | undefined, …>(OIMScalarKeyTreeWalk.INSTANCE)`.
- A field belongs to one environment and its `db`: a slot of another `db` that is read is reported by an error thrown from the field's pass (after the flush, or from its microtask) and asks nothing; the other slots of that pass are still asked.
- `isSlotDemanded(slot)` says which read slots are demand; without it every read slot is. The field calls it in its pass after the flush, for each slot that got its first reader — a read column slot as its entity slot — before it holds the key: `false` holds nothing and asks nothing for that slot. Cards that a bucket answer has already written are not asked one by one: `createReceptiveField(cardReceptor, { selectKey: (cardId: string): [cardId: string] => [cardId], isSlotDemanded: (cardSlot: TOIMEntitySlot<TCard, string>) => cardSlot.entity === undefined })` — without it a screen of a deck's cards sends the bucket request and one request per card. The answer is taken once per first reader: a slot that was not demand stays so while it is read, even when its content goes away later; it is asked again only when it gets a first reader again after it lost every reader. A throw in it is reported like a throw in `selectKey`.
- A service whose slots never need a request gets no field.
- Tests: `packages/oimdb/src/tests/CNSOIMDBHomeostatReceptiveField.test.ts`, `packages/oimdb/src/tests/CNSOIMDBHomeostatReact.test.tsx`.

### transduce over fetch

`CNSHomeostatReceptorFetch({ fetch?, baseUrl?, headers?, timeoutMs? }).send({ url, method?, body?, headers? }, abortSignal)` sends one request with its method, a JSON body and the merged headers, rejects a non-2xx status with `METHOD url: HTTP status`, rejects a request that has not answered within `timeoutMs` (30000 by default, `Infinity` for none) with `METHOD url: timed out after timeoutMs ms`, and resolves with the parsed JSON as `unknown` (`undefined` for a response without a body, such as 204) — check its shape before the receptor answers with it, and encode a key part you put in `url`: an id with `/`, `?` or `#` would fetch another resource:

```ts
const api = new CNSHomeostatReceptorFetch({ baseUrl: 'https://api.example.com' });
const remoteDeckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({ name: 'deck', transduce: async ([deckId], abortSignal) => parseDeck(await api.send({ url: `/decks/${encodeURIComponent(deckId)}` }, abortSignal)) });
```

### One request for what a screen reads

Three ways to ask, chosen receptor by receptor, and one screen can mix them:

1. **queries** — a `transduce` per key (REST by call), read through `createComputedStoreAggregate`;
2. **slots over REST** — the same `transduce` behind a receptive field: the slots on the screen ask, each key its own request;
3. **slots over one endpoint** — every key of the screen in one `GET`, like GraphQL over `GET`: `CNSHomeostatBatchTransducer` gathers the keys, `CNSHomeostatTransductionFetch` sends them, `CNSHomeostatTransductionEndpoint` answers them on the backend. The format and the transport are replaceable.

`CNSHomeostatBatchTransducer({ batchTransduceFn, batchScheduleFn? }).transduceOf(name, parse)` makes a `transduce` that does not send on its own: every key asked until the next macrotask goes into one call of `batchTransduceFn` — keys of every receptor that uses the transducer, a deck read through a query and its cards read through a receptive field alike. Reads only.

```ts
type TCard = { id: string; deck: string; title: string };
declare function parseCard(value: unknown): TCard;

const homeostatTransductionFetch = new CNSHomeostatTransductionFetch({ url: 'https://api.example.com/sync' });
const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({ batchTransduceFn: homeostatTransductionFetch.batchTransduceFn });
const batchedDeckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
    name: 'deck',
    transduce: homeostatBatchTransducer.transduceOf('deck', ([deck]) => parseDeck(deck)),
});
const deckCardsReceptor = new CNSHomeostatReceptor<[deckId: string], TCard[]>({
    name: 'deckCards',
    staleTimeMs: 2_000,
    transduce: homeostatBatchTransducer.transduceOf('deckCards', cards => cards.map(parseCard)),
});
```

A deck and its cards on one screen are one request: `GET /sync?deck=d1&deckCards=d1`. The default codec, `CNSHomeostatTransductionQueryCodec`, writes it so:

- names, then keys, sorted and without repeats, so the same keys give the same URL, split or not;
- the parts of a key are joined by `,`, keys by `;`: `cardsPage=d1,~,~20` is `['d1', undefined, 20]` — a number is `~20`, `undefined` is `~`, `null` is `~n`, `true` and `false` are `~t` and `~f`, an empty string is `~e`, a string that starts with `~` gets a second one, everything is percent-encoded; another kind of key part fails the batch;
- the answer is a flat list of `[request, data]`, `[request, null, error]` and `[request]` — a key answered with no entity, an empty list — `request` being the index of the key in the query: one row per entity, no name and key repeated in it. An `Error` in an error row is sent as `{ name, message }`.

`CNSHomeostatTransductionFetch({ url, homeostatTransductionCodec?, fetch?, headers?, maxUrlLength?, timeoutMs? })` sends the codec's `mediaType` as `Accept` (over an `Accept` in `headers`) and splits a query longer than `maxUrlLength` (4096 by default) into several `GET`s that run together; a single key longer than that goes alone, and the server may answer it `414`. A `GET` that fails — a non-2xx status (the error carries `status`), a network error, an answer it cannot read, no answer within `timeoutMs` (30000 by default, `Infinity` for none; the error is `GET url: timed out after timeoutMs ms`) — fails only its own keys; the other `GET`s answer theirs. A key the codec cannot write fails alone and is not sent. The `url` has no query or fragment of its own: the query is the codec's.

The backend, with any framework: `CNSHomeostatTransductionEndpoint({ batchTransduceFn, homeostatTransductionCodecs?, maxBatchSize? }).respond(query, accept)` picks the codec by `Accept` as RFC 9110 says — the most specific range decides a codec's `q`, the highest `q` wins, `q=0` refuses, a tie goes to the order of `homeostatTransductionCodecs`, no header takes the first codec; `406` with the media types it has when none fits, `400` for a query it cannot read, `413` for more keys than `maxBatchSize` — decodes the keys, calls your `batchTransduceFn` once and encodes the rows; the answer carries `vary: accept`. When your `batchTransduceFn` rejects, `respond` rejects — your framework answers `500`. A row for a key nobody asked for is dropped, so the asked key it was meant for fails alone on the client with «was not answered». An `Error` in an error row keeps its own fields (`status`) next to `name` and `message`, and every one of them reaches the client: map a database or driver error to `{ status, message }` before it goes into a row, as GraphQL servers do with `errors`. `maxBatchSize` counts the keys after the covers add theirs: allow for what one `GET` of `maxUrlLength` can carry times what the covers add, or a full `GET` is refused every time.

The URL is stable, so an answer can be cached, but `respond` sets no `Cache-Control`: caching is yours to add, for data that is the same for every user — a shared cache does not keep an answer to a request with `Authorization` unless it says `public` or `s-maxage` — and for no longer than the `staleTimeMs` of its keys, or a poll reads the cached copy.

```ts
declare const sql: (query: TemplateStringsArray, ...values: unknown[]) => Promise<{ deckId: string; deckTitle: string; cardId: string | null; cardTitle: string | null }[]>;
declare const app: { get(path: string, handle: (request: { url: string; headers: { accept?: string } }, reply: (status: number, headers: Record<string, string>, body: string) => void) => Promise<void>): void };

const syncEndpoint = new CNSHomeostatTransductionEndpoint({
    batchTransduceFn: async (homeostatTransductionRequests) => {
        const deckIds = homeostatTransductionRequests.map(({ key: [deckId] }) => String(deckId));
        const joined = await sql`select d.id as "deckId", d.title as "deckTitle", c.id as "cardId", c.title as "cardTitle"
            from decks d left join cards c on c.deck = d.id where d.id = any(${deckIds})`;
        const homeostatTransductionRows: TCNSHomeostatTransductionRow[] = [];
        for (const { name, key } of homeostatTransductionRequests) {
            const deckRows = joined.filter(row => row.deckId === key[0]);
            const deckRow = deckRows[0];
            if (name === 'deck') {
                homeostatTransductionRows.push(deckRow === undefined ? { name, key, error: { status: 404 } } : { name, key, data: { id: deckRow.deckId, title: deckRow.deckTitle } });
            }
            if (name === 'deckCards') {
                const cardRows = deckRows.filter(row => row.cardId !== null);
                if (cardRows.length === 0) homeostatTransductionRows.push({ name, key });
                for (const row of cardRows) homeostatTransductionRows.push({ name, key, data: { id: row.cardId, deck: row.deckId, title: row.cardTitle } });
            }
        }
        return homeostatTransductionRows;
    },
});

app.get('/sync', async (request, reply) => {
    const { status, headers, body } = await syncEndpoint.respond(request.url.slice(request.url.indexOf('?') + 1), request.headers.accept);
    reply(status, headers, body);
});
```

A key can cover another: when the backend answers a deck with its cards anyway, `new CNSHomeostatTransductionQueryCodec({ homeostatTransductionCovers: [{ coveringName: 'deck', coveredName: 'deckCards', selectCoveredKey: deckKey => deckKey }] })` leaves `deckCards=d1` out of the URL whenever `deck=d1` is in the same batch — a screen with two decks and their cards asks `GET /sync?deck=d1;d2`. A card list asked without its deck still goes in the URL. The endpoint, given the same codec, reads `deck=d1` back as both keys, so your `batchTransduceFn` gets the deck and its cards and answers both; the covers are named in the codec's `mediaType`, so a client with other covers gets `406` instead of rows filed under wrong keys; a `selectCoveredKey` that changed is caught only when you bump the cover's `revision`. The media type carries the format version (`.v1`), so a later format answers `406` instead of being misread. A cover with a `revision` puts it in the media type too, so a changed `selectCoveredKey` can be told apart. A cover of a cover works the same way (`deck` → `deckCards` → `deckCardsCount`); a cycle of covers is refused when the codec is built. A covered key whose deck goes in another `GET` of a split batch is answered by that `GET`. The cost: every request for a deck asks for its cards, also from a screen that shows no cards — their rows are dropped on the client.

A codec of your own is an `ICNSHomeostatTransductionCodec`: a `mediaType`, `dropCoveredRequests?` (the keys that go in the query, when it covers keys), `encodeRequests` / `decodeRequests` for the query and `encodeRows` / `decodeRows` for the answer. Give it to the fetch, and add it to the endpoint's `homeostatTransductionCodecs` — the endpoint answers each client in the codec it accepts. A transport of your own is any `batchTransduceFn(requests, abortSignal)`: a POST, a WebSocket, a JSON-RPC 2.0 batch.

- A key gets the `data` of all its rows as a list, in order: a single entity reads `([deck]) => …`, a list reads the whole list. A key answered with a row without `data` (`{ name, key }`, `[request]` on the wire) gets `[]` — `parse` decides whether that is an answer or an error. A key the transport did not answer at all fails with «was not answered»: a backend that forgot a name, or does not know it yet, never empties a list. A `parse` that throws fails only its key. A row with `error` fails its key with that error. A rejected `batchTransduceFn` fails every key of the batch.
- The window is one macrotask (`setTimeout(…, 0)`), not a microtask: a receptive field asks its keys from a later drain of the queue than the queries of the same flush, and a microtask would split them. `batchScheduleFn` replaces the window.
- A key asked twice in one batch is sent once. A key aborted before the batch leaves is not sent; the batch's `abortSignal` aborts only when every key in it is aborted — one key leaving the screen does not cancel the request, its answer is dropped.
- Polling: keys that go stale together go together. In OIMDB the refetch wheel hands every key due in one slice over at once, so the cards of every deck on the screen with the same `staleTimeMs` are one request per poll; the wheel cuts time into slices of `OIM_SLICE_LENGTH_MS` (1024 ms) and a key due in a slice is asked at the start of the next one, so a poll comes up to two slices after its `staleTimeMs` — a poll more often than about once a second needs your own `scheduleRefetchAt`. In MobX keys due at the same millisecond share one timer and are asked in one action. The next poll is counted from the answer, so the period is `staleTimeMs` plus the batch window plus the round trip.
- Renders: the answers of one batch are written in one drain — one flush in OIMDB, one action in MobX — so a screen renders once for the whole batch. A poll renders twice when the screen reads the status of the polled keys (`Firing`, then the answer) and once when it reads only the data; an answer equal to the last one renders again unless the writer skips it (see «Loading and the result»).
- What does not go together: a key asked a macrotask later (a list that renders only after its deck has loaded is the next request), keys due at different times, two databases whose queues drain in different macrotasks.
- A row whose `name` and `key` match no key of the batch is dropped: a transport of your own that answers a key in another form (`'1'` for `1`) leaves that key «not answered». The query codec answers by index and cannot miss.
- In OIMDB a slot that left the screen lets its key go at the next flush; a request that answers before that flush is written.
- One screen can mix the ways a key is asked, receptor by receptor: a `transduce` of its own per call (REST by key, through a query), the same `transduce` behind a receptive field (REST for the slots on the screen), or `transduceOf` of one transducer (every receptor through one route). `packages/oimdb/src/tests/CNSOIMDBHomeostatBatchTransducer.test.ts` asks decks by REST and their cards through one route on one screen.
- JSON-RPC 2.0 batch as the transport: map each request to `{ jsonrpc: '2.0', id: index, method: name, params: key }` and each response back to rows by `id` — responses may come in any order; a list `result` is one row per item, and `{ name, key }` when it is empty, or the key fails «was not answered».
- Tests: `packages/sync/src/tests/CNSHomeostatBatchTransducer.test.ts` (the transducer, JSON-RPC 2.0), `CNSHomeostatTransductionQueryCodec.test.ts`, `CNSHomeostatTransductionFetch.test.ts` (one `GET` through the endpoint, splitting, another codec), `CNSHomeostatTransductionEndpoint.test.ts` (picking the codec); `packages/oimdb/src/tests/CNSOIMDBHomeostatBatchTransducer.test.ts` (one request for a screen and the frames it renders, REST and one route on one screen, polling, a key leaving mid-flight, invalidate during a batch, a refractory retry of one failed key, offline); `packages/mobx/src/tests/CNSMobXHomeostatBatchTransducer.test.ts` (one request for a screen and its frames, polling and its frames).

### Replacing a part

`createCNSOIMDBHomeostatEnvironment` (and `createCNSMobXHomeostatEnvironment`) fill every part with a default; pass an option to replace one. Every row below has a test that replaces the part and checks the queries stay correct, run on both bindings (`packages/sync/src/tests/conformance`):

| option | replaces |
|---|---|
| `homeostatFiringPolicy` | when a query may fire: any `{ isFiringAllowed(), isRefiringAllowed() }` (plus `sourceSlots` in OIMDB) — sign-in, focus instead of visibility |
| `createHomeostatRefetchPolicy(receptor)` | when a record goes stale or a failure is retried; by default `staleTimeMs` and `homeostatRefractoryPolicy` of the receptor, else of the environment |
| `createHomeostatCorrectionRepository(receptor)` | where the records of a receptor live, by key hash, and how long a record stays after the last query holding its key leaves (`holdHomeostatCorrectionState` / `unholdHomeostatCorrectionState`); called once per receptor |
| `keyHashFn(key)` | key identity: which keys share a request and a record, and which held keys `invalidateByKeyPrefix` matches (it is also called on the prefix and on the leading parts of a key). `CNSHomeostatBatchTransducer` and `CNSHomeostatTransductionQueryCodec` join keys by `hashCNSHomeostatKey` (`JSON.stringify`) whatever you pass, so `undefined`, `null`, `NaN` and `±Infinity` in one key position are one key there |
| `createHomeostatRegulator(options)` | the regulator of a receptor |
| `stimulationOptionsOf(receptor)` | the stimulation options of a receptor's signals; by default the environment's and the receptor's, contexts merged |
| `getNowMs` | the clock of the records |
| `runUntracked`, `runInTransaction`, `runWrite`, `scheduleRefetchAt` | scheduling: after the derivation, the batch an answer is written in, `invalidate` from inside a derivation, the stale timer (it may return a cancel function, called when the key is rescheduled, when the last reader leaves and on `dispose()` — both defaults return one) |
| `staleTimeMs`, `homeostatRefractoryPolicy`, `stimulationOptions` | defaults for receptors that do not set them |

A failure is asked again only with a `homeostatRefractoryPolicy`, and then on every delay while the key is read. To give up on answers a second try cannot change — TanStack Query's `retry` function — wrap the default policy over the receptor's own values; `CNSHomeostatReceptorFetch` and `CNSHomeostatTransductionFetch` put the HTTP `status` on their errors:

```ts
import { CNSHomeostatStaleTimeRefetchPolicy } from '@cnstra/sync';
import type { TCNSHomeostatCorrectionState } from '@cnstra/sync';

const httpStatusOf = (error: unknown) =>
    typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;

const createHomeostatRefetchPolicy = (homeostatReceptor: CNSHomeostatReceptor<never, unknown>) => {
    const staleTimeRefetchPolicy = new CNSHomeostatStaleTimeRefetchPolicy({
        staleTimeMs: homeostatReceptor.staleTimeMs ?? Infinity,
        homeostatRefractoryPolicy: homeostatReceptor.homeostatRefractoryPolicy,
    });
    return {
        refetchAtMs: (homeostatCorrectionState: TCNSHomeostatCorrectionState<unknown>) => {
            const httpStatus = httpStatusOf(homeostatCorrectionState.error);
            return httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 ? Infinity : staleTimeRefetchPolicy.refetchAtMs(homeostatCorrectionState);
        },
    };
};
```

It keeps each receptor's `staleTimeMs` and `homeostatRefractoryPolicy`, as the default does; put your environment-wide values after `??` if you have them. Pass it as `createHomeostatRefetchPolicy` to the environment factory; a `4xx` key then stays `Failed` until `invalidate` or a new reader after its record is released.

A `runInTransaction` of your own must not throw: an answer whose stimulation throws there is never written, its readers stay `Firing` until released, and the error is thrown from the drain of the run queue — the first one of the drain; every later one is thrown on its own in a microtask (`cnsRunAll`) — while `waitUntilSettled()` rejects with it.

The correction neuron takes `reduceHomeostatCorrectionState` — how an answer becomes a record (`reduceCNSHomeostatCorrectionState` by default). Whether a `Restored` answer is too old to deliver is the regulator's: an answer to a request started before the last `invalidate` never reaches the correction neuron or a writer, so a reducer of your own sees only answers the regulator delivers; a `Failed` answer of such a request still reaches it and is written `Stale` by the default reducer.


### Cost and memory

- A read whose sources did not change costs nothing of ours: OIMDB stops at its revision check, MobX returns its cached computed.
- A re-derive costs the regulator a comparison of the source and of the record. The key hash is computed once per source and records are found by it — no serialisation on a re-derive. A keyed OIMDB query does one plain `Map` lookup; a source-tracking OIMDB query does one `WeakMap` lookup (OIMDB gives a single computed no per-query derive) and reuses its record slot while the key holds. OIMDB records are keyed by the key hash.
- The regulator keeps one entry per held key: its holder count, its running request and its refetch.
- A request costs one running-request object with its `AbortController`, the stimulation options, two signals and the promise handlers; a promise only for `waitUntilSettled()`. A request that has its answer is not aborted when its readers settle and leave. Several queries settling on one key schedule one refetch.
- What the regulator runs after the derivation — fires, answers, deferred clears — goes through one queue per environment: OIMDB drains it once after the flush (one subscription however many queries asked) or in one microtask outside a flush; MobX in one microtask, inside one `runInAction`.
- Each `invalidate` writes one stale record — a placeholder when the key is held and has none — and keeps one waiter on the key. Each request that started before it costs one more request after its answer, and one more stale write. `invalidateByKeyPrefix` walks every key the receptor holds and calls `keyHashFn` on the leading parts of each, then one `invalidate` per match.
- Every `Restored` answer costs one promise: the regulator waits for its stimulation to fail the key when a writer fails.
- A record lives while any query holds its key; when the last one is released the regulator forgets the key and tells the repository (`unholdHomeostatCorrectionState`). OIMDB releases the record's slot by the correction store's release policy — `OIMSlotAtUnholdReleasePolicy` by default, at once; a record written into a key nobody holds goes at the next flush, so a repository filled in advance (persisted, shared) needs a keeping policy such as `OIMSlotAfterUnholdReleasePolicy` or `OIMSlotNeverReleasePolicy`. MobX deletes it in a microtask, or after `keepAfterUnholdMs` with one timer per released key (re-armed past `2 ** 31 - 1` ms; never with `Infinity`); a record written into a key nobody holds is deleted the same way. A kept record costs its slot or its map entry until the window ends. The running request of a key is aborted when its last holder leaves before its answer. A keyed OIMDB query enters the binding's maps on its first derive and leaves them when OIMDB releases its value, so a slot that is created and never read leaves nothing behind. A source-tracking OIMDB query is kept in a weak map by its store slot and goes when the store slot is dropped.
- The MobX stale timer is cancelled when the last reader leaves. In OIMDB the cancel drops the key's refetch at once; the slot stays filed in the refetch wheel until its slice is swept and then does nothing, unless it was the last scheduled refetch — then the whole wheel is cleared with its timer.
- A MobX query must be read inside a reaction (`autorun`, `reaction`, `observer`). A read outside one — or inside an action before any reaction observes the query — holds its key until a reaction observes and then drops it; MobX reports no unobservation for it. The computeds are created with `requiresReaction`, which MobX turns into a warning in development builds for reads outside a batch only.

Another state manager is a new binding: a repository, three scheduling methods and its computed — see `@cnstra/mobx`.
