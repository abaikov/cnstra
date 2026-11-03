---
id: devtools-overview
title: DevTools Overview
sidebar_label: Overview
sidebar_position: 2
slug: /devtools/overview
---

# CNStra DevTools

Debugging and monitoring for CNStra applications: every run your app makes, task by task, with Retry and Clone on a failed one.

[Try it in the browser](pathname:///devtools/?transport=demo): the real panel opened with `?transport=demo` runs a small shop flow, a devtools client and a devtools server inside the page itself, with no network and nothing to install.

## Features

The panel is one Explorer with five tabs:

- **Stimulations**: every run, newest first, filterable by status, entry collateral, neuron, text and time range. A selected run opens a waterfall of its attempts and tasks, with **Retry** (resume the failed frontier) and **Clone** (a fresh run from the entry).
- **Neurons** and **Collaterals**: per-entity throughput and errors, and a diagram of what flows in and out of the selected one.
- **Activation tasks**: every task across runs, with its input and output collaterals and its error.
- **Scheduled**: jobs waiting in a connected queue, and an **Enqueue** form for a job type.

Above the tabs: connection health, a status breakdown and a throughput chart.

The desktop app adds a **Server Manager** that starts and stops DevTools servers on custom ports, on macOS, Windows and Linux.

> Several **replicas of one** service are a different case: they share one `appId`
> and one graph, and a Retry click reaches all of them unless a broker link is
> configured. See [Running DevTools in a real deployment](./deployments.md).

## Quick Start

1. **Download** the DevTools application from the [Download page](/docs/devtools/download)
2. **Install** the DevTools package in your project:
   ```bash
   npm i -D @cnstra/devtools @cnstra/devtools-server @cnstra/devtools-transport-ws
   ```
3. **Configure** your application to connect to DevTools:
   ```ts setup
   import type { CNS } from '@cnstra/core';
   import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
   import type { TCNSNeuron } from '@cnstra/types';

   declare const cns: CNS<TCNSNeuron>;
   declare const registry: CNSPersistOptionsRegistry;
   ```

   ```ts
   import { CNSDevTools } from '@cnstra/devtools';
   import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

   const transport = new CNSDevToolsTransportWs({ 
     url: 'ws://localhost:8080' 
   });
   
   const devtools = new CNSDevTools('my-app', transport, {
     appName: 'My App DevTools',
   });
   
   devtools.registerCNS(cns, registry); // your CNSPersistOptionsRegistry
   ```
4. **Launch** DevTools and start debugging!

## Use Cases

- **Development**: Debug complex neural networks during development
- **Testing**: Verify signal flows and responses in test scenarios
- **Performance**: Identify bottlenecks and optimize neural network performance
- **Production Monitoring**: Monitor live applications (with appropriate security measures)

## Next Steps

- [Download DevTools](/docs/devtools/download) - Get the desktop application
- [Integration Guide](/docs/devtools/integration) - Learn how to integrate DevTools
- [Stimulations](/docs/devtools/stimulations) - The Explorer, Retry and Clone
