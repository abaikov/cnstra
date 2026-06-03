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

```ts
// dev.ts  ← excluded from prod entry point
import { startDevTools } from '@cnstra/devtools-server';
import { cns } from './cns';
import { registry } from './src/neurons/registry'; // your CNSPersistOptionsRegistry

await startDevTools(cns, registry);
// → 🧠 CNStra DevTools: http://localhost:3141
```

If you don't have a shared registry yet:

```ts
import { createPersistRegistry } from '@cnstra/core';
import { deckNeuron, cardNeuron } from './neurons';
const registry = createPersistRegistry({ deckNeuron, cardNeuron });
```

Opens the browser automatically. The UI, WebSocket server, and your CNS instance are all wired up in one call.

### Options

```ts
await startDevTools(cns, registry, {
    port: 3141,    // default
    open: true,    // auto-open browser (default: true in TTY)
    appId: 'app',  // label shown in DevTools
    consoleLogEnabled: false,
});
```

### With Next.js

```ts
// next.config.ts
if (process.env.NODE_ENV === 'development') {
    const { startDevTools } = await import('@cnstra/devtools-server');
    const { cns } = await import('./src/cns');
    const { registry } = await import('./src/neurons/registry');
    await startDevTools(cns, registry);
}
```

### With Vite

```ts
// vite.config.ts
export default defineConfig({
    plugins: [{
        name: 'cnstra-devtools',
        async buildStart() {
            if (process.env.NODE_ENV === 'development') {
                const { startDevTools } = await import('@cnstra/devtools-server');
                const { cns } = await import('./src/cns');
                const { registry } = await import('./src/neurons/registry');
                await startDevTools(cns, registry);
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
    devToolsInstanceName: 'My App',
});
devtools.registerCNS(cns, 'main');
```

Open `http://localhost:3141` in your browser.

---

## DevTools Features

Once connected:

- **Graph view** — interactive neuron graph with live signal flow
- **Stimulations** — list of all stimulations with full hop traces
- **Signal Debugger** — inject signals manually to test flows
- **Performance** — response times, queue lengths, error rates
- **Context Inspector** — per-stimulation context at each hop
- **Snapshot & Replay** — record a session and replay it deterministically

## Production

DevTools are dev-only. In production:

- Don't import `@cnstra/devtools-server` or call `startDevTools`
- Don't import `@cnstra/devtools` or `@cnstra/devtools-transport-ws`
- The `CNSPersistOptionsRegistry` (used for naming) is also dev-only

All devtools packages should be in `devDependencies` only.
