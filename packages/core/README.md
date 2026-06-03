# @cnstra/core

**Workflow / orchestration engine for TypeScript — deterministic, embeddable, in-memory.**

📚 **[Full Documentation →](https://cnstra.org/)** | [Quick Start](https://cnstra.org/docs/core/quick-start) | [API Reference](https://cnstra.org/docs/core/api) | [Recipes](https://cnstra.org/docs/recipes)

## What is CNStra?

**CNStra (Central Nervous System Orchestrator)** models your app as a **typed neuron graph**. You explicitly start a run with `cns.stimulate(...)`; CNStra then performs a **deterministic, hop-bounded traversal** from **collateral → dendrite → returned signal**, step by step.

**Zero dependencies** • **No pub/sub** • **CNS approach** (Central Neural Network of your app)

Common backend use-cases:
- **Jobs** (queues/workers), **sync/integrations** (webhooks), **ETL/pipelines**
- **Retries/timeouts/cancellation** and **saga-style compensations**

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

## Registry & Naming

`CNSPersistOptionsRegistry` maps object references to stable string names — used by devtools, MCP server, and persistence/resume patterns.

**Per-file registration (recommended):**

```ts
// src/neurons/registry.ts
import { CNSPersistOptionsRegistry } from '@cnstra/core';
export const registry = new CNSPersistOptionsRegistry();

// src/neurons/deck.ts — each neuron registers itself
import { collateral, withCtx } from '@cnstra/core';
import { registry } from './registry';

const deckCreated = collateral<{ deckId: string }>();
const importStarted = collateral<{ importId: string }>(); // external entry point

const deckNeuron = withCtx()
    .neuron({ deckCreated })
    .bind({ importStarted }, {
        importStarted: ({ importId }, axon) => axon.deckCreated.createSignal({ deckId: importId }),
    });

registry
    .register('deckNeuron', deckNeuron)                    // registers neuron + axon collaterals
    .register('deckNeuron', deckNeuron, { deckCreated: 'deck-created' }) // explicit collateral names
    .registerCollateral('importStarted', importStarted);   // standalone collateral (no neuron)
```

**All at once (simple projects):**

```ts
import { createPersistRegistry } from '@cnstra/core';

export const registry = createPersistRegistry({ deckNeuron, cardNeuron });
// explicit neuron name:        { 'deck-neuron': deckNeuron }
// explicit collateral names:   { 'deck-neuron': { neuron: deckNeuron, collaterals: { deckCreated: 'deck-created' } } }
```

## Documentation

- **[Quick Start Guide](https://cnstra.org/docs/core/quick-start)** — Get up and running in minutes
- **[API Reference](https://cnstra.org/docs/core/api)** — Complete API documentation
- **[Concepts](https://cnstra.org/docs/core/concepts)** — Neurons, collaterals, signals, and the CNS model (Central Neural Network of your app)
- **[Recipes](https://cnstra.org/docs/recipes)** — Common patterns and use cases
- **[Advanced Topics](https://cnstra.org/docs/advanced)** — Performance, context stores, integrations

---

*CNStra provides deterministic, type-safe orchestration without the complexity of traditional event systems.*
