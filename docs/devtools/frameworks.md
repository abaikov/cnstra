---
id: devtools-frameworks
title: Express, NestJS, Fastify
sidebar_label: Express / NestJS
slug: /devtools/frameworks
description: Where to start the CNStra DevTools panel in a plain Express app, a NestJS module or a Fastify server — what to put in the entry point, how to shut it down, and how to keep it out of production.
keywords: [devtools, express, nestjs, fastify, koa, integration, startCNSDevTools, onModuleInit, graceful shutdown]
---

The panel does not care what serves your HTTP. It needs two things — the `CNS`
instance and the registry that names its neurons — and one decision: does the
DevTools server run inside your process, or beside it.

- **Inside your process** (`startCNSDevTools`) — one call, no extra deployment. Right
  for local development and a single-process app.
- **Beside it** (a standalone `@cnstra/devtools-server`, apps dial out to it) — the
  only option once you run more than one replica, because an in-process server
  would exist once per replica and each would see only itself. See
  [Deployments](./deployments.md).

Everything below is the first shape. The second is the same in every framework:
construct `CNSDevTools` with a WebSocket transport where you would have called
`startCNSDevTools`.

The examples assume an app with these two modules:

```ts file=src/cns.ts
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';

export type TOrder = { id: string };
export const orderCreated = cnsCollateral<TOrder>();
export const orderAccepted = cnsCollateral<TOrder>();
export const orders = cnsNeuron({ orderAccepted }).dendrite({
    collateral: orderCreated,
    response: (order, axon) => axon.orderAccepted.createSignal(order),
});
export const cns = new CNS([orders]);
export type TOrdersCNS = typeof cns;
```

```ts file=src/neurons/registry.ts
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { orders } from '../cns';

export const registry = CNSPersistOptionsRegistryFactory.create({ orders });
```

```ts setup
import type { CNS } from '@cnstra/core';
import type { TCNSNeuron } from '@cnstra/types';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { ICNSBullActionQueueLike } from '@cnstra/bullmq';
import { startCNSDevTools } from '@cnstra/devtools-server';
import { CNSDevTools } from '@cnstra/devtools';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
declare const ordersQueue: ICNSBullActionQueueLike;
declare function Fastify(): { listen(options: { port: number }): Promise<string> };
```

## Plain Express

Keep the call out of the module that defines your routes, so nothing about
DevTools is reachable from the request path:

```ts file=src/server.ts
// src/server.ts
import express from 'express';
import { cns, orderCreated } from './cns';
import { registry } from './neurons/registry';

const app = express();
app.post('/orders', async (req, res) => {
    await cns.stimulate(orderCreated.createSignal(req.body)).waitUntilComplete();
    res.sendStatus(202);
});

const server = app.listen(3000);

// DevTools is a development tool: it shows payloads and offers Retry to anyone
// who can open it. Gate it, do not ship it on by accident.
if (process.env.CNSTRA_DEVTOOLS === '1') {
    const { startCNSDevTools } = await import('@cnstra/devtools-server');
    const devtools = await startCNSDevTools(cns, registry, {
        appId: 'orders-api',
    });
    console.log(`DevTools: ${devtools.url}`);

    process.on('SIGTERM', () => {
        devtools.stop();
        server.close();
    });
}
```

Two details worth knowing:

- **`open`** defaults to whether stdout is a TTY, so a container already gets
  `false` and a local `npm run dev` gets `true`. Set it explicitly only when you
  want the opposite of that.
- **The dynamic `import`** is the point of the flag. With a static import the
  package sits in your production bundle and its dependencies are installed in
  production, even when the flag is off.

## NestJS

Nest owns the lifecycle, so the panel goes in a module that starts it on init and
stops it on shutdown. The `CNS` and the registry become ordinary providers:

```ts file=src/cns.module.ts
// cns.module.ts
import { Module, Inject } from '@nestjs/common';
import type { TCNSDevToolsHandle } from '@cnstra/devtools-server';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { cns, type TOrdersCNS } from './cns';
import { registry } from './neurons/registry';

export const CNS = Symbol('CNS');
export const REGISTRY = Symbol('CNS_REGISTRY');

@Module({
    providers: [
        { provide: CNS, useValue: cns },
        { provide: REGISTRY, useValue: registry },
    ],
    exports: [CNS, REGISTRY],
})
export class CnsModule {
    private devtools?: TCNSDevToolsHandle;

    constructor(
        @Inject(CNS) private readonly cns: TOrdersCNS,
        @Inject(REGISTRY) private readonly registry: CNSPersistOptionsRegistry,
    ) {}

    async onModuleInit(): Promise<void> {
        if (process.env.CNSTRA_DEVTOOLS !== '1') return;
        const { startCNSDevTools } = await import('@cnstra/devtools-server');
        this.devtools = await startCNSDevTools(this.cns, this.registry, {
            appId: 'orders-api',
        });
    }

    onApplicationShutdown(): void {
        this.devtools?.stop();
    }
}
```

`onApplicationShutdown` only fires if you called `app.enableShutdownHooks()` —
without it the panel's port stays held until the process is killed, which is
exactly the kind of thing that makes a redeploy hang.

Inject `CNS` wherever you stimulate:

```ts file=src/orders.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { orderCreated, type TOrder, type TOrdersCNS } from './cns';
import { CNS } from './cns.module';

@Injectable()
export class OrdersService {
    constructor(@Inject(CNS) private readonly cns: TOrdersCNS) {}

    async create(order: TOrder): Promise<void> {
        await this.cns
            .stimulate(orderCreated.createSignal(order))
            .waitUntilComplete();
    }
}
```

## Fastify, Koa, anything else

Identical to Express — the panel runs its own HTTP listener on its own port and
shares nothing with yours:

```ts
const fastify = Fastify();
await fastify.listen({ port: 3000 });

if (process.env.CNSTRA_DEVTOOLS === '1') {
    const { startCNSDevTools } = await import('@cnstra/devtools-server');
    await startCNSDevTools(cns, registry, { appId: 'orders-api' });
}
```

There is no plugin or middleware to register: nothing about DevTools sits on your
request path, so it cannot slow a route down or leak into a response.

## Keeping run history across restarts

By default the panel's store is in-memory and dies with the process — fine for
development, useless the moment you restart while reading an incident. Pass a
Postgres store, and the same instance you give a queue worker as its `observe`
store, so jobs and HTTP-triggered runs land in one place:

```ts
import { Pool } from 'pg';
import { CNSPostgresStimulationRepository, CNSPostgresStimulationSchema } from '@cnstra/persist-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await CNSPostgresStimulationSchema.migrate(pool);   // once, from a place you control
const runs = new CNSPostgresStimulationRepository({ pool });

await startCNSDevTools(cns, registry, { stimulationRepository: runs });
```

See [Stimulations](./stimulations.md) for what the store holds and
[Deployments](./deployments.md) for running the server separately.

## Retry through a queue, and hiding an action

`startCNSDevTools` takes the same two knobs as the server it builds, so you do not
have to drop to assembling one by hand as soon as you need them:

```ts
import { createCNSBullActions } from '@cnstra/bullmq';

await startCNSDevTools(cns, registry, {
    appId: 'orders-api',
    // Retry goes through the broker instead of the app socket — which is what
    // stops one click running on every replica.
    actions: [createCNSBullActions(ordersQueue)],
    // This deployment never overwrites a run's record in place.
    ui: { actions: { retry: false } },
});
```

Both are explained in [Deployments](./deployments.md#retry-with-replicas) and
[Retry & clone](./stimulations.md#retry--clone).

## What the panel needs from your network

**A WebSocket, in both directions, by default.** The panel opens a `WebSocket` to
the server, and the app connects with `@cnstra/devtools-transport-ws`. All
protocol traffic is on the socket; the HTTP port otherwise serves the panel's
assets.

That matters when something between you and the server does not pass WebSocket
upgrades. Typical culprits: an ingress or load balancer with upgrades off, a
corporate proxy, a serverless platform that terminates long-lived connections.
Without a fallback the panel would sit reconnecting and show nothing.

**There is an HTTP fallback for both sides.** The server always exposes it at
`/__cnstra/poll` on the same port; the socket stays the default and polling is
what you switch to when an upgrade will not get through.

For the panel, add `?transport=polling` to its URL — that is a link you can hand
to whoever is stuck behind the proxy, and the header shows `· polling` so nobody
wonders why the view is a poll behind.

For the app, swap the transport:

```ts
import { CNSDevToolsTransportHttp } from '@cnstra/devtools-transport-http';

const transport = new CNSDevToolsTransportHttp({ url: 'http://cnstra-devtools:3141' });
const devtools = new CNSDevTools('orders-worker', transport);
```

Both sides speak the same protocol over three endpoints — a `POST` per message, a
long `GET` that parks until something is queued, a `DELETE` on shutdown. Expect
the panel to lag by up to one poll, and a failed request to back off rather than
retry tightly.

## Before you turn it on outside development

- The panel **shows payloads**. Whatever your signals carry — a customer address,
  a token — is visible to anyone who can open it. Redact at the write path if that
  matters: [Middleware chains](../advanced/middleware.md).
- The panel **offers Retry and Clone**. Both re-run real work. A server can turn
  either off — see [Retry & clone](./stimulations.md#retry--clone).
- Bind it to an internal address. Nothing in DevTools authenticates anybody.
