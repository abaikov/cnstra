---
id: devtools-deployments
title: Running DevTools in a real deployment
sidebar_label: Deployments
slug: /devtools/deployments
description: What the DevTools panel shows when a service runs as several replicas — what appId, cnsId and scopeName actually route, why a pod with no CNS does not appear, and what a Retry click does with two workers connected.
keywords: [devtools, deployment, replicas, appId, cnsId, scopeName, retry, actions, middleware, createCNSBullActions, createCNSPgBossActions, rolling deploy]
---

Three pods: an Express API that is public, and two replicas of a worker that runs
CNStra. You want the panel. This page is what each id means once there is more than
one process, and what the **Retry** button does when two replicas are connected at
once.

## Where the server runs

The DevTools server is a process of its own. It is **not** something each replica
starts: `startCNSDevTools` boots a server inside your process, which is right for one
dev machine and wrong for a deployment — two replicas would boot two servers,
each seeing only itself.

For a replicated service, run one server and point every replica at it:

```bash
# its own pod / container
npx @cnstra/devtools-server        # listens on 3141
```

```ts setup
import { CNS } from '@cnstra/core';
import type { TCNSNeuron } from '@cnstra/types';
import type { CNSPersistOptionsRegistry, ICNSStimulationRepository } from '@cnstra/persist';
import type { ICNSDevToolsServerRepository } from '@cnstra/devtools-server';
import { enqueueCNSStimulation } from '@cnstra/bullmq';
import type { ICNSBullActionQueueLike, TCNSStimulationJobData } from '@cnstra/bullmq';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
declare const repository: ICNSDevToolsServerRepository;
declare const stimulationRepository: ICNSStimulationRepository;
declare const queue: ICNSBullActionQueueLike;
declare const ordersQueue: ICNSBullActionQueueLike;
declare const job: TCNSStimulationJobData;
declare const order: { id: number };
```

```ts
// in each worker replica — the SAME appId in all of them
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({
    url: process.env.CNSTRA_DEVTOOLS_URL!,   // e.g. ws://cnstra-devtools:3141
});
const devtools = new CNSDevTools('orders-worker', transport, { cnsId: 'orders' });
devtools.registerCNS(cns, registry);
```

The replicas dial **out** to the server, so it needs no route into the pods — an
internal service address is enough, and nothing about DevTools has to be exposed
publicly. Expose only the server's HTTP port, and only to whoever should see your
run data: the panel shows payloads, and anyone who can open it can press Retry.

Keep the server's own storage in mind: it defaults to an in-memory stimulation
store, which dies with the pod. Inject a Postgres store when the run history
should outlive a restart — see [Stimulations](./stimulations.md).

## The three ids

| id | where it comes from | what it identifies | what it does |
| --- | --- | --- | --- |
| `appId` | first argument of `new CNSDevTools('orders-worker', transport, …)`, or `startCNSDevTools({ cns, registry }, { appId })` | the **service** — not the process | the routing key: the server keeps `appId → Set<socket>` and delivers a forwarded action to that set |
| `cnsId` | the `cnsId` option; defaults to `` `${appId}:cns` `` | one graph **inside** the service | the topology snapshot is stored under it; one service may host several graphs |
| `scopeName` | recorded on every run — it is the `cnsId` the run executed on | which graph a run belongs to | the server resolves `scopeName → appId` to decide where a resume goes |

**Give each replica its own `appId`** — the pod name, the hostname, anything
unique per process:

```ts
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({ url: process.env.CNSTRA_DEVTOOLS_URL! });
const devtools = new CNSDevTools(
    `orders-worker-${process.env.HOSTNAME}`,
    transport,
);
```

That is what makes a Retry land on **one** pod. The routing chain is
`run.scopeName → findAppByCns → appId → sockets`, and `cnsId` defaults to
`` `${appId}:cns` `` — so a unique `appId` gives each pod a unique `cnsId`, each
run records the `cnsId` it actually executed on, and the retry goes back to
exactly that pod. Share one `appId` across replicas and the last step resolves to
*all* of their sockets, which is how one click becomes N runs (see
[Retry with replicas](#retry-with-replicas)).

:::danger Do not pin `cnsId` to a shared literal while doing this

`cnsId → appId` is a map with last-writer-wins. With unique `appId`s but a
hardcoded `cnsId: 'orders'` in every pod, every run resolves to whichever pod
registered last — the retry runs on the wrong pod, silently. Either let `cnsId`
default, or make it unique too.

:::

What this costs, so you are not surprised:

- **The server keeps one app record per pod**, each with its own copy of the same graph.
- **Dead pods stay.** App records are not removed when a socket
  closes, so across deploys they accumulate; pod names change every rollout.
- **A run whose pod is gone cannot be retried over the socket.** Its `cnsId`
  resolves to an app with no live socket, and the action falls through to the
  next link in the chain — which is another reason to configure a broker link
  when the runs come from a queue.

## The pod with no graph

If the Express pod never constructs a `CNS`, it does not appear in the panel at
all. There is nothing to draw — the panel's unit is a graph, not a process.

If it only enqueues jobs, the run belongs to the **worker's** graph and shows up
there. What ties the two together is the id you choose when you enqueue: with
`jobId` set to a business key, the `stimulationId` in the panel is the same string
your API pod already logged.

```ts
await enqueueCNSStimulation(queue, job, { jobId: `order-${order.id}` });
// panel: stimulationId "order-42", attempts "order-42#1", "order-42#2", …
```

See [Choosing the stimulation id](../integrations/opentelemetry.md#choosing-the-stimulation-id)
for the three ways to pick one and what each costs.

## Topology under a rolling deploy

Every replica pushes its topology snapshot on connect, and snapshots are stored
keyed by `cnsId` — so replicas overwrite each other. While they run identical
code that is harmless: the snapshot they all report is the same one.

During a rolling deploy where the graph itself changed, the panel shows whichever
replica connected last. There is no version or content hash on a snapshot to tell
old from new, and no warning when two differ. Treat the Neurons and Collaterals diagrams as unreliable
for the duration of a rollout of a changed topology; the run data (Stimulation →
Attempt → Task) is unaffected, because each run carries its own names.

## Retry with replicas

Panel actions — Retry, Clone — go through an ordered middleware chain, the third
constructor argument of `CNSDevToolsServer`. The server appends its own link
**last**: forward the action to the app over its socket.

That socket link sends to **every** connected socket of the app. If replicas
share one `appId`, one Retry click runs the resumed frontier on **all** of them —
nothing de-duplicates it. Giving each replica its own `appId` (see
[The three ids](#the-three-ids)) is what keeps that set down to the single pod
that ran the job.

In production, put a broker link in front so the retry goes through the queue,
where delivery and de-duplication are the broker's problem:

```typescript
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { createCNSBullActions } from '@cnstra/bullmq';

new CNSDevToolsServer(repository, stimulationRepository, [
    createCNSBullActions(ordersQueue),
]);
```

`createCNSBullActions` asks the queue whether it holds a job with that
`stimulationId`:

- **yes** → it calls the broker's own `job.retry()`. Same job id, history kept,
  `attemptsMade` incremented, and the resume checkpoint is found by that same id —
  so the frontier does not have to be shipped anywhere. The link stops the chain.
- **no** → the run did not come from this queue, so the link calls `next()` and
  the action carries on down the chain.

`createCNSPgBossActions(boss, queue)` is the pg-boss equivalent, same shape and same
reasoning. A Clone or Replay is a new run, so both links enqueue a new job under
the new id instead.

Runs that were started by an HTTP handler or a cron rather than by the queue fall
through the broker link and reach the socket link — which is what an in-process
CNS needs. So a mixed deployment works, with the replica caveat above applying
only to the runs that reach the socket link.

If the chain runs out with nobody acting, the panel is told the action was
rejected (`no runtime accepted the retry`) rather than being left with a button
that reported success and did nothing.

`startCNSDevTools` and `createCNSDevToolsHandler` take the same `actions` and `ui`
options and pass them to the server they build; a pg-boss worker, or a BullMQ
worker given its `Queue` instance as `queue`, passed as the source brings its own link. An in-process panel does not have
to be reassembled by hand to route Retry through a broker — see [Admin](./admin.md).

## When the network will not carry a WebSocket

A standalone server is reached over whatever sits in front of it, and that is the
one deployment where the panel's default connection can fail outright: an ingress
with upgrades off, a corporate proxy, a platform that cuts long-lived connections.
The panel then reconnects forever and shows nothing, while the server is healthy.

Both sides can fall back to HTTP, on the same port, at `/__cnstra/poll` — always
exposed, no flag to turn it on. The socket stays the default; polling is what a
client asks for. On polling the panel reads its lists and details with one
`GET /__cnstra/sync` per poll and sends Retry, Clone and the queue commands
through `/__cnstra/poll`, so an ingress in front of it lets both paths through.

- **The panel** — open it with `?transport=polling`. That is a link you can hand
  to whoever is behind the proxy without changing anything for everyone else, and
  the header reads `· polling` so nobody wonders why the view is a poll behind.
- **An app** — swap `@cnstra/devtools-transport-ws` for
  `@cnstra/devtools-transport-http`; the constructor takes the same `url`, over
  `http://` rather than `ws://`.

Sessions are held by id and dropped after a minute of silence — a polling client
has no `close` event, so going quiet is the only signal it gives. That is also
what takes it out of Retry routing, which matters here: a session kept forever
would keep being offered actions it will never carry out. Both timings are on
`polling` (`waitMs`, `sessionTtlMs`); the defaults park a poll for 25s, under the
read timeout of the proxies that make polling necessary in the first place.

## See also

- [Middleware chains](../advanced/middleware.md) — writing your own action link, and the separate write chain
- [Stimulations (Explorer)](./stimulations.md) — what Retry and Clone do to the run model
- [Integration](./integration.md) — the two ways to run the panel
