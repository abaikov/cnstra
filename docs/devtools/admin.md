---
id: devtools-admin
title: Admin
sidebar_label: Admin
slug: /devtools/admin
description: Run the CNStra DevTools panel as the admin of your app — one call on its own port, or mounted under a path in Express, Fastify, Next.js or Hono behind your own auth, read-only, with or without a WebSocket.
keywords: [devtools, admin, dashboard, express, fastify, next.js, hono, auth, read-only, basePath, createCNSDevToolsHandler, startCNSDevTools]
---

The panel is an admin for your flows: every run, its attempts and tasks, Retry and
Clone. It can run on its own port for development, or be mounted into the server
you already have, under a path, behind the auth you already use.

```ts setup
import type { IncomingMessage, ServerResponse } from 'http';
import type { CNS } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSNeuron } from '@cnstra/types';
import { createCNSWorker } from '@cnstra/pg-boss';
import type { ICNSPgBossLike } from '@cnstra/pg-boss';
import { createCNSDevToolsHandler, startCNSDevTools } from '@cnstra/devtools-server';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
declare const boss: ICNSPgBossLike;
declare function isAdmin(cookie: string | undefined): Promise<boolean>;
declare const middie: unknown;
declare const fastify: {
    register(plugin: unknown): Promise<unknown>;
    use(path: string, handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void;
};
```

## 1. One line

```ts
const worker = await createCNSWorker({ boss, cns, registry, queue: 'cns' });

await startCNSDevTools(worker);
// → 🧠 CNStra DevTools: http://localhost:3141
```

The worker brings its `cns`, its registry and its queue. The panel links to that
`cns` in-process and records every job under its job id, into a bounded in-memory
history (up to 1000 runs) unless you pass a `stimulationRepository`. Retry / Clone
go through pg-boss under the same job id. For BullMQ, pass your `Queue` instance as
`queue` and the worker brings the same link; with only a queue name, Retry and
Clone run in this process, which is fine while there is one. No worker?
Pass `{ cns, registry }`.

This is a development server: its own port, bound to `127.0.0.1` unless you pass
`host`, no auth. Everything below is for running the panel inside your app.

## 2. Mount it in your server

`createCNSDevToolsHandler` takes the same source and options and returns the panel as
a handler, in two shapes: `node` for anything built on Node's `http` (Express,
Connect, Nest, Fastify through middie) and `fetch` for anything built on the Fetch
API (Next.js route handlers, Hono, Bun, Deno). Auth is yours: put your middleware in
front of it, the way you would for any admin route.

### Express

```ts
import express from 'express';

const worker = await createCNSWorker({ boss, cns, registry, queue: 'cns' });
const admin = createCNSDevToolsHandler(worker, { basePath: '/admin/cnstra' });

const app = express();
app.use('/admin/cnstra', async (request, response, next) => {
    if (await isAdmin(request.headers.cookie)) return next();
    response.sendStatus(403);
}, admin.node);
app.listen(3000);
```

`basePath` is the full path the panel lives at. Anything under it that is not the
panel calls `next()`, so your own routes there still work.

### Fastify

Through `@fastify/middie`, which runs before Fastify reads the body:

```ts
const admin = createCNSDevToolsHandler({ cns, registry }, { basePath: '/admin/cnstra' });

await fastify.register(middie);
fastify.use('/admin/cnstra', async (request, response, next) => {
    if (!(await isAdmin(request.headers.cookie))) {
        response.statusCode = 403;
        return response.end();
    }
    return admin.node(request, response, next);
});
```

### Next.js route handler

```ts
// app/admin/cnstra/[[...path]]/route.ts
const admin = createCNSDevToolsHandler({ cns, registry }, { basePath: '/admin/cnstra' });

const handle = async (request: Request): Promise<Response> =>
    (await isAdmin(request.headers.get('cookie') ?? undefined))
        ? admin.fetch(request)
        : new Response('Forbidden', { status: 403 });

export { handle as GET, handle as POST, handle as DELETE };
```

The panel keeps its state in the process: history, the in-process link, open poll
sessions. Run it on the Node.js runtime of a long-lived server (`next start`), not on
an edge or per-request function. A poll waits up to 25 seconds for news; if your
platform cuts requests sooner, lower `polling: { waitMs }` below that limit.

### Hono

```ts
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';

const admin = createCNSDevToolsHandler({ cns, registry }, { basePath: '/admin/cnstra' });

const app = new Hono();
for (const path of ['/admin/cnstra', '/admin/cnstra/*']) {
    app.use(path, basicAuth({ username: 'admin', password: process.env.ADMIN_PASSWORD ?? '' }));
    app.all(path, context => admin.fetch(context.req.raw));
}
```

### Read-only

```ts
const admin = createCNSDevToolsHandler({ cns, registry }, { basePath: '/admin/cnstra', readOnly: true });
```

A read-only panel registers no action links and hides Retry and Clone. The server
answers every Retry, Clone, Launch and command message with a rejection whatever
sends it, so hiding the buttons is not the only thing standing between a viewer and
a rerun.

Whether read-only or not, a browser can only view: polling sessions and WebSocket
clients of the handler are viewers, the server drops any `batch` message they send,
and none of them is ever registered as an app. The only app is the `cns` linked
in-process. A polling `POST` is accepted only with `content-type: application/json`
and answered 415 otherwise, so a page on another site cannot send one without a
CORS preflight, and the handler answers no preflight.

### WebSocket

By default the panel talks to the handler over HTTP polling, which needs nothing
but the routes above. A WebSocket is opt-in, and only with an `authorizeUpgrade` of
your own: an upgrade does not pass through your HTTP middleware, so the handler asks
you directly. Without it no upgrade is accepted.

```ts
import { createServer } from 'http';
import express from 'express';

const admin = createCNSDevToolsHandler({ cns, registry }, {
    basePath: '/admin/cnstra',
    webSocket: { authorizeUpgrade: request => isAdmin(request.headers.cookie) },
});

const app = express();
app.use('/admin/cnstra', admin.node);

const server = createServer(app);
server.on('upgrade', admin.upgrade);
server.listen(3000);
```

`startCNSDevTools` takes the same `webSocket` option. There, leaving out
`authorizeUpgrade` accepts an upgrade only from a loopback address, and only if it
carries no Origin header (a non-browser client) or an Origin equal to the server's own
loopback host and port, so another web page open in the same browser cannot
connect. That default is for the local development server only: behind a proxy
every client arrives from a loopback address, so a deployment passes its own
`authorizeUpgrade`.

### What the handler serves

| path under `basePath` | what |
| --- | --- |
| `/` | the panel page, with its asset URLs pointed at `basePath` and its config embedded |
| `/assets/…` and the other files of the panel build | static files; hashed assets are cached as immutable |
| `/__cnstra/poll` | the polling endpoint of the DevTools protocol |
| `/__cnstra/sync` | the endpoint the panel reads runs, facets and topology from |

No CORS headers are sent: the panel is served from the same origin as its API.
`dispose()` unlinks the panel from the `cns` and closes every session.

### A separate admin process

The handler records runs through its in-process link, so it sees the jobs of the
process it runs in. To run the admin somewhere else, give the workers an `observe`
store they all write to, such as a `CNSPostgresStimulationRepository`, and hand the
same store to the admin as `stimulationRepository`; the admin reads the history from
it. Do not also pass that store to an admin running inside a worker process: the
in-process link already records those jobs, and the store would get each one twice.

## 3. Serve the files yourself

The panel is a static build in `@cnstra/devtools-panel-ui/dist`. To serve it from
your own static host on the same origin, copy the folder there, mount the handler at
the same `basePath` for the API routes, and add the config tag the handler would have
added, before the first script of `index.html`:

```html
<script type="application/json" id="cnstra-devtools-config">{"basePath":"/admin/cnstra","transport":"polling","readOnly":false}</script>
```

Serve the page at `/admin/cnstra/`, with the trailing slash, so the build's relative
asset URLs resolve under it.

## 4. A frontend library

To show the panel as a page of the admin you already have, mount the handler as in
section 2 and render the panel from your own frontend, pointed at the same
`basePath`. The panel is shipped as a browser bundle in
`@cnstra/devtools-panel-ui/embed`, with its styles in
`@cnstra/devtools-panel-ui/embed.css`.

The panel's runtime, Exodra, OIMDB and the CNStra client packages, comes as peer
dependencies, so your app keeps one copy of each:

```bash
npm install @cnstra/devtools-panel-ui @cnstra/core @cnstra/devtools-dto @cnstra/sync @cnstra/oimdb @cnstra/exodra @cnstra/persist-dto @cnstra/types @exodra/core @exodra/dom @exodra/jsx @exodra/context @exodra/list-reconcile @oimdb/core @oimdb/browser @oimdb/exodra
```

### Any frontend

```ts
import { mountCNSDevToolsPanel } from '@cnstra/devtools-panel-ui/embed';
import '@cnstra/devtools-panel-ui/embed.css';

const element = document.getElementById('cnstra-admin');
const panel = element === null ? undefined : mountCNSDevToolsPanel(element, { url: '/admin/cnstra' });
```

`url` is the base URL of the handler, absolute or relative to the page. `transport`
is `'polling'` by default; pass `'socket'` only to a handler that accepts WebSocket
upgrades. `isReadOnly: true` hides Retry and Clone; refusing them is the handler's
`readOnly`. The panel fills the element's height, so give the element one. Call
`panel.unmount()` when your page leaves the panel: it closes the connection and
removes what it rendered.

If your app already uses OIMDB, pass its database: the panel puts its schema into
your `OIMDB` instead of creating one. This is the recommended way for an app on OIMDB.
Unmounting disposes what the panel created and leaves your database open.

```ts
import { OIMDB } from '@oimdb/core';
import { mountCNSDevToolsPanel } from '@cnstra/devtools-panel-ui/embed';

declare const appDb: OIMDB;

const adminElement = document.getElementById('cnstra-admin');
if (adminElement !== null) mountCNSDevToolsPanel(adminElement, { url: '/admin/cnstra', db: appDb });
```

`location` says where the panel keeps its navigation. The default, `'memory'`, keeps
it inside the panel and never touches the page's URL, so your router's hash is safe
and several panels can share a page. With `'hash'`, the way the standalone page
runs, the panel writes the page's URL hash when it connects (the default time window
the server sends) and on every navigation, so it overwrites your hash: mount at most
one such panel per page.

### React

```bash
npm install @cnstra/devtools-panel-react
```

Add it next to the packages above.

```tsx
import { CNSDevToolsPanel } from '@cnstra/devtools-panel-react';
import '@cnstra/devtools-panel-ui/embed.css';

export function AdminCNStraPage() {
    return <CNSDevToolsPanel url="/admin/cnstra" style={{ height: '100vh' }} />;
}
```

`CNSDevToolsPanel` takes the same options as props, `db` included, plus `className` and `style` for
its outer div. It mounts the panel into an inner div of full height, and mounts it
again when `url`, `transport`, `isReadOnly` or `location` change.

### What the panel is

The panel is written in Exodra and renders into its own element, not through React.
Its styles are scoped to that element with `@scope (.cns-devtools)`, so none of them
leak into your admin. The other direction is not sealed: a global rule of your
admin, such as a reset on every button, still reaches the panel's elements.

Compiling the panel's source into plain React components is possible with
`@exodra/to-react`, which translates Exodra machines into React components that
render the same DOM. Its output is complete only when the translator's
`unsupported` list is empty, so check that list for every file. The bundle is the
recommended path.

### Auth

The embed holds no credentials and has no auth of its own: it only calls
`basePath/__cnstra/poll` and `basePath/__cnstra/sync` of the handler, from your
page, with your page's cookies. The handler sends no CORS headers, so `url` must be
on the same origin as the page. Whatever middleware guards those routes in section 2
guards the embedded panel. A WebSocket transport is
authorized by the handler's `authorizeUpgrade`, as in section 2.

## How other admins do it

The shape is the one job-queue dashboards settled on:

- **Bull Board** is mounted on a base path in your Express (or Fastify, Koa, Hono)
  app, and authentication is whatever middleware you put in front of it. Its queue
  adapters take a read-only mode.
- **Sidekiq::Web** is a Rack app you mount in your routes, usually inside a route
  constraint such as Devise's `authenticate` block, so only admins reach it.
- **Hangfire Dashboard** is mounted with an authorization filter, and has a
  read-only switch too.

The panel takes the same shape: a base path, auth by wrapping, read-only as an
option. Unlike Hangfire, the handler has no local-only default for HTTP: mounted in
your server it answers whoever reaches the route, so the auth in front of it is
yours. Only `startCNSDevTools` is local by default: it binds `127.0.0.1`, answers only
requests whose `Host` is this loopback server (a DNS-rebinding page gets 403),
and its WebSocket accepts loopback clients of its own origin.
