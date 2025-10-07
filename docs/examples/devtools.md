---
id: devtools
title: Devtools
sidebar_label: Devtools
slug: /examples/devtools
---

Connect the devtools to visualize neuron graphs and inspect stimulation flows.

```ts
import { CNSDevTools } from '@cnstra/devtools';
import { CNSDevToolsTransportWs } from '@cnstra/devtools-transport-ws';

const transport = new CNSDevToolsTransportWs({ url: 'ws://localhost:8080' });
const devtools = new CNSDevTools('my-app', transport, {
  devToolsInstanceName: 'My App DevTools',
});
devtools.registerCNS(cns);
```

- Run the devtools server and open the panel UI to explore the graph.
- Filter signals, inspect context, and measure timings.
