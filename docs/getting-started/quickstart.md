---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
slug: /getting-started/quickstart
---

A minimal example to wire neurons, signals, and stimulation.

```ts
import { CNS, createNeuron, stimulate } from '@cnstra/core';

// Create a simple neuron
const addPrefix = createNeuron<string, string>(({ signal }) => {
  return `CNS: ${signal}`;
});

// Boot a CNS instance
const cns = new CNS();

// Send a signal and receive response
const result = await stimulate(cns, addPrefix, 'hello');
console.log(result); // => "CNS: hello"
```

Next:
- Understand the architecture: [Concepts → Architecture](/docs/concepts/architecture)
- Explore core primitives: [Concepts → Core Primitives](/docs/concepts/core-primitives)
- Use in React: [Guides → React](/docs/guides/react)
- Devtools: [Guides → Devtools](/docs/guides/devtools)
