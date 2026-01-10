# @cnstra/core

**Graph-routed, type-safe orchestration for reactive apps — no global event bus.**

📚 **[Full Documentation →](https://cnstra.org/)** | [Quick Start](https://cnstra.org/docs/core/quick-start) | [API Reference](https://cnstra.org/docs/core/api) | [Recipes](https://cnstra.org/docs/recipes)

## What is CNStra?

**CNStra (Central Nervous System Orchestrator)** models your app as a **typed neuron graph**. You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a **deterministic, hop-bounded traversal** from **collateral → dendrite → returned signal**, step by step.

**Zero dependencies** • **No pub/sub** • **CNS approach** (Central Neural Network of your app)

👉 **[Read the full documentation →](https://cnstra.org/)**

## Quick Start

```bash
npm install @cnstra/core
```

```typescript
import { CNS, collateral, neuron } from '@cnstra/core';

// Define collaterals (communication channels)
const userCreated = collateral<{ id: string; name: string }>();
const userRegistered = collateral<{ userId: string; status: string }>();

// Create a neuron
const userService = neuron({
  userRegistered
})
.dendrite({
  collateral: userCreated,
  response: (payload, axon) => {
    return axon.userRegistered.createSignal({
      userId: payload.id,
      status: 'completed'
    });
  }
});

// Create the CNS system
const cns = new CNS([userService]);

// Stimulate the system
const stimulation = cns.stimulate(userCreated.createSignal({
  id: '123',
  name: 'John Doe'
}));
await stimulation.waitUntilComplete();
```

## Documentation

- **[Quick Start Guide](https://cnstra.org/docs/core/quick-start)** — Get up and running in minutes
- **[API Reference](https://cnstra.org/docs/core/api)** — Complete API documentation
- **[Concepts](https://cnstra.org/docs/core/concepts)** — Neurons, collaterals, signals, and the CNS model (Central Neural Network of your app)
- **[Recipes](https://cnstra.org/docs/recipes)** — Common patterns and use cases
- **[Advanced Topics](https://cnstra.org/docs/advanced)** — Performance, context stores, integrations

---

*CNStra provides deterministic, type-safe orchestration without the complexity of traditional event systems.*
