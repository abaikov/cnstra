---
id: devtools-example
title: DevTools Example
sidebar_label: Basic Example
---

# DevTools Basic Example

Connect the DevTools to visualize neuron graphs and inspect stimulation flows.

## Setup

```ts
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({ url: 'ws://localhost:8080' });
const devtools = new CNSDevTools('my-app', transport, {
  devToolsInstanceName: 'My App DevTools',
});
devtools.registerCNS(cns);
```

## Usage

1. Run the DevTools server and open the panel UI to explore the graph
2. Filter signals, inspect context, and measure timings
3. Monitor real-time signal propagation through your neural network

For detailed integration instructions, see the [DevTools section](/docs/devtools/overview).
