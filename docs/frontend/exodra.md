---
id: exodra
title: Exodra Views with CNStra & OIMDB
sidebar_label: CNStra & Exodra
slug: /frontend/exodra
description: Connect Exodra machines to a CNS. An event port becomes a signal, the CNS comes from the Exodra context first and from the app default after it, and the screen reads OIMDB and the homeostat queries in its effects.
---

`@cnstra/exodra` turns an event port of an Exodra machine into a signal of a CNS. The rest of a screen is OIMDB: the neurons write slots, the machine reads them in its effects.

```sh
npm install @cnstra/exodra @cnstra/core @cnstra/types @cnstra/sync @cnstra/oimdb @oimdb/core @exodra/core @exodra/context @exodra/dom
```

```ts setup
import { collateral, neuron, createCNS } from '@cnstra/core';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection, ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { createCNSOIMDBHomeostatEnvironment } from '@cnstra/oimdb';
import { OIMDB, createOIMEntitySlotCollectionStoreAggregate } from '@oimdb/core';
import { EXO_PORT_EVENT, EXO_PORT_TEXT, composeExoMachine, composeExoPlugins, createExoMachine, createExoSchema, exoPorts, withExoEffects, withExoHandlers, withExoWire } from '@exodra/core';
import type { TExoMachineNodeOf } from '@exodra/core';
import { ExoDomBackend, createExoDelegatedEvents, withExoCompiler } from '@exodra/dom';
import type { TExoDomNode } from '@exodra/dom';
import { injectCNS, provideCNS, withCNSReceptors } from '@cnstra/exodra';

type TDeck = { id: string; title: string };

declare function fetchDeck(deckId: string, abortSignal: AbortSignal): Promise<TDeck>;
declare function saveDeckTitle(deckId: string, title: string): Promise<void>;
declare function askTitle(): string | undefined;
declare function showError(error: unknown): void;
declare const root: HTMLElement;
```

## The graph and the database

The receptor, the correction neuron and the collaterals hold no database and stay in their modules. Every neuron that writes a slot is a factory over the schema, and `createCNS` builds them for one database:

```ts setup shown
const deckHomeostatReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
    name: 'deck',
    staleTimeMs: 30_000,
    transduce: ([deckId], abortSignal) => fetchDeck(deckId, abortSignal),
});
const homeostatReceptorCorrection = new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckHomeostatReceptor] });
const deckRenamed = collateral<{ deckId: string; title: string }>();

const createDeckSchema = (db: OIMDB) => ({ decks: createOIMEntitySlotCollectionStoreAggregate<TDeck>(db) });
type TDeckSchema = ReturnType<typeof createDeckSchema>;

const createDeckWriter = ({ decks }: TDeckSchema) => neuron({}).dendrite({
    collateral: deckHomeostatReceptor.axon.homeostasisRestored,
    response: ({ key: [deckId], data }) => { decks.writeSlotContentByKey(deckId, data); },
});
const createDeckRenamer = ({ decks }: TDeckSchema) => neuron({}).dendrite({
    collateral: deckRenamed,
    response: ({ deckId, title }) => {
        decks.writeSlotContentByKey(deckId, { id: deckId, title });
        return saveDeckTitle(deckId, title);
    },
});

const createAppDB = () => new OIMDB({
    createSchemas: db => {
        const deck = createDeckSchema(db);
        const cns = createCNS([() => deckHomeostatReceptor.neuron, () => homeostatReceptorCorrection.neuron, createDeckWriter, createDeckRenamer], deck);
        cns.addDrainListener(() => db.flush());
        const homeostatEnvironment = createCNSOIMDBHomeostatEnvironment({ db, cns });
        return { deck, cns, homeostatEnvironment, deckQueries: homeostatEnvironment.createComputedStoreAggregate(deckHomeostatReceptor) };
    },
});
```

Your own neurons go into the same list. A neuron without dependencies goes in as `() => neuron`; `createCNS` checks the dependencies against every factory and throws when one is listed twice.

## The services of a node

The backend gives every node the database, the CNS and the queries. The `cns` service is the CNS of every receptor unless `provideCNS` gives another one above the node.

```ts setup shown
const db = createAppDB();
const { deck, cns, deckQueries } = db.schemas;

type TDeckNode = TExoDomNode & {
    readonly oimdb: typeof db;
    readonly cns: typeof cns;
    readonly decks: typeof deck.decks;
    readonly deckQueries: typeof deckQueries;
};

const backend = composeExoPlugins(withExoCompiler(new ExoDomBackend()), {
    events: () => createExoDelegatedEvents(['click']),
    oimdb: () => db,
    cns: () => cns,
    decks: () => deck.decks,
    deckQueries: () => deckQueries,
});
```

## A machine

The effect reads the query and the slot in one OIMDB effect; a receptor turns the click into `deckRenamed`.

```ts setup shown
const DeckPorts = exoPorts({ TITLE: EXO_PORT_TEXT, RENAME: EXO_PORT_EVENT });
const DeckSchema = createExoSchema(DeckPorts, b => {
    b.el('article', null, article => {
        article.el('h1', null, h1 => { h1.textPort(DeckPorts.TITLE); });
        article.el('button', null, button => { button.eventPort(DeckPorts.RENAME, 'click'); });
    });
});

const deckBase = createExoMachine<TDeckNode, string, { deckId: string }>(DeckSchema, {
    createInitialState: (_node, deckId) => ({ deckId }),
});

const showDeck = (node: TExoMachineNodeOf<typeof deckBase>) => {
    const deckHomeostasis = node.deckQueries.getSlotByKey([node.state.deckId]).value;
    const shownDeck = node.decks.getSlotByKey(node.state.deckId).entity;
    if (shownDeck !== undefined) node.text(DeckPorts.TITLE, shownDeck.title);
    else if (deckHomeostasis.status === ECNSHomeostatCorrectionStatus.Failed) node.text(DeckPorts.TITLE, 'Could not load the deck');
    else node.text(DeckPorts.TITLE, 'Loading…');
};

export const deckMachine = composeExoMachine(
    deckBase,
    m => withExoEffects(m, effect => {
        effect(node => node.oimdb.createEffect(() => showDeck(node)));
    }),
    m => withCNSReceptors(m, receptor => {
        receptor(DeckPorts.RENAME, deckRenamed, node => {
            const title = askTitle();
            return title === undefined ? undefined : { deckId: node.state.deckId, title };
        });
    }),
);
```

```ts
const dispose = backend.render(deckMachine, root, 'd1');
```

- **Which CNS.** The one `provideCNS` gave on the node or on an ancestor before that ancestor built the child, then the node's `cns` service. A node type without `cns` does not compile; a backend that registers none throws on the event, naming both places.
- **No signal.** A `payloadOf` that returns `undefined` sends nothing — above, a cancelled prompt. The payload is checked against the collateral: a collateral without payload takes no `payloadOf`, one with payload needs it.
- **One handler per port.** A receptor and a handler on the same port throw when the machine is defined: «already has a handler» in development, `EXO0111` in production.
- **No result.** A receptor drops the stimulation it starts: a failed task, like a rejected `saveDeckTitle` above, reaches only a `cns.addResponseListener` registered before the event, as `response.error`. A screen that must show the failure stimulates from a handler, below.

## Another CNS for a subtree

`provideCNS` takes any CNS; a machine from a library sees it too, since the context token is one for the process:

```ts
declare const previewCNS: typeof cns;

export const previewDeckMachine = composeExoMachine(
    deckMachine,
    m => withExoWire(m, node => { provideCNS(node, previewCNS); }),
);
```

## Outside a receptor

A handler that needs `stimulate` options, the returned stimulation or several signals takes the same CNS with `injectCNS`, `provideCNS` included:

```ts
const RenameNowPorts = exoPorts({ RENAME: EXO_PORT_EVENT });
const RenameNowSchema = createExoSchema(RenameNowPorts, b => {
    b.el('button', null, button => { button.eventPort(RenameNowPorts.RENAME, 'click'); });
});

export const renameNowMachine = composeExoMachine(
    createExoMachine<TDeckNode>(RenameNowSchema),
    m => withExoHandlers(m, on => {
        on(RenameNowPorts.RENAME, node => {
            injectCNS(node)
                .stimulate(deckRenamed.createSignal({ deckId: 'd1', title: 'Renamed' }))
                .waitUntilComplete()
                .catch(showError);
        });
    }),
);
```

What a screen shows after a signal comes from the slots its effects read, not from the responses of the CNS: the neuron writes the slot, the effect redraws; a neuron whose write can fail writes the failure into a slot the same way, as the homeostat writes `Failed` for reads. Waiting on the stimulation, as above, is for a one-off reaction such as a toast. See [Sync (homeostat)](./sync.md) for the queries, the receptive fields and the dispose order.
