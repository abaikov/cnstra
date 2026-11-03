---
id: devtools-integration
title: DevTools Integration
sidebar_label: Integration
sidebar_position: 3
slug: /devtools/integration
---

# DevTools Integration

Two ways to run the DevTools UI — pick the one that fits your setup.

## Option A: Embedded (one function call)

Best for: Next.js, Vite, any Node.js dev server where you control the process.

```bash
npm i -D @cnstra/devtools-server
```

The examples assume your app keeps its `CNS` in `src/cns.ts`:

```ts file=src/cns.ts
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';

export const deckCreated = cnsCollateral<{ deckId: string }>();
export const cardAdded = cnsCollateral<{ deckId: string }>();
export const deckNeuron = cnsNeuron({ deckCreated });
export const cardNeuron = cnsNeuron({ cardAdded }).dendrite({
    collateral: deckCreated,
    response: (payload, axon) => axon.cardAdded.createSignal(payload),
});
export const cns = new CNS([deckNeuron, cardNeuron]);
```

```ts setup
import type { CNS } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSNeuron } from '@cnstra/types';
import { startCNSDevTools } from '@cnstra/devtools-server';

declare const cns: CNS<TCNSNeuron>;
declare const registry: CNSPersistOptionsRegistry;
```

```ts file=dev.ts
// dev.ts  ← excluded from prod entry point
import { startCNSDevTools } from '@cnstra/devtools-server';
import { cns } from './src/cns';
import { registry } from './src/neurons/registry'; // your CNSPersistOptionsRegistry

await startCNSDevTools(cns, registry);
// → 🧠 CNStra DevTools: http://localhost:3141
```

If you don't have a shared registry yet:

```ts file=src/neurons/registry.ts
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { deckNeuron, cardNeuron } from '../cns';
export const registry = CNSPersistOptionsRegistryFactory.create({ deckNeuron, cardNeuron });
```

Opens the browser automatically. The UI, WebSocket server, and your CNS instance are all wired up in one call.

### Options

```ts
await startCNSDevTools(cns, registry, {
    port: 3141,    // default
    open: true,    // auto-open browser (default: true in TTY)
    appId: 'app',  // identifies the SERVICE — the routing key for Retry/Clone
    consoleLogEnabled: false,
});
```

`appId` is not a display label. It is the key the DevTools server routes commands
by: it keeps `appId → sockets`, and a Retry or Clone is delivered to that set. Run
more than one replica and each one needs its **own** `appId`, or a single Retry
runs on all of them — see
[Running DevTools in a real deployment](./deployments.md).

:::caution Not for a replicated deployment

`startCNSDevTools` builds the server for you and takes no actions chain, so Retry and
Clone are delivered over the app socket — to **every** connected replica of the
`appId`. With more than one replica that runs the same retry more than once.

Construct `CNSDevToolsServer` yourself when you need a broker link in front. See
[Retry with replicas](./deployments.md#retry-with-replicas).

:::

### With Next.js

```ts file=next.config.ts
// next.config.ts
if (process.env.NODE_ENV === 'development') {
    const { startCNSDevTools } = await import('@cnstra/devtools-server');
    const { cns } = await import('./src/cns');
    const { registry } = await import('./src/neurons/registry');
    await startCNSDevTools(cns, registry);
}
```

### With Vite

```ts file=vite.config.ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [{
        name: 'cnstra-devtools',
        async buildStart() {
            if (process.env.NODE_ENV === 'development') {
                const { startCNSDevTools } = await import('@cnstra/devtools-server');
                const { cns } = await import('./src/cns');
                const { registry } = await import('./src/neurons/registry');
                await startCNSDevTools(cns, registry);
            }
        }
    }]
});
```

---

## Option B: Standalone server

Best for: when your app and DevTools server run as separate processes (e.g. browser app, React Native, separate backend).

```bash
# Terminal 1 — start DevTools server
npx @cnstra/devtools-server
# → 🧠 CNStra DevTools: http://localhost:3141

# Or with custom port:
PORT=4000 npx @cnstra/devtools-server
```

Then connect your app:

```bash
npm i -D @cnstra/devtools @cnstra/devtools-transport-ws
```

```ts
// dev entry point
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({ url: 'ws://localhost:3141' });
const devtools  = new CNSDevTools('my-app', transport, {
    appName: 'My App',
});
devtools.registerCNS(cns, registry); // your CNSPersistOptionsRegistry
```

Open `http://localhost:3141` in your browser.

---

## DevTools Features

Once connected, the Explorer shows every run with its attempts and tasks, per-neuron and per-collateral throughput and errors, and Retry and Clone on a failed run. See [Stimulations](./stimulations.md).

## Production

DevTools are dev-only. In production:

- Don't import `@cnstra/devtools-server` or call `startCNSDevTools`
- Don't import `@cnstra/devtools` or `@cnstra/devtools-transport-ws`
- The `CNSPersistOptionsRegistry` (used for naming) is also dev-only

Install every devtools package as a dev dependency (`npm i -D`) only.
