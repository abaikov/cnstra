# @cnstra/core

**Orchestration engine for TypeScript — deterministic, embeddable, in-memory.**

📚 **[Full Documentation →](https://cnstra.org/)** | [Quick Start](https://cnstra.org/docs/core/quick-start) | [API Reference](https://cnstra.org/docs/core/api) | [Recipes](https://cnstra.org/docs/recipes)

## What is CNStra?

**CNStra** (Central Nervous System Orchestrator) models your app's control flow as a graph of **neurons** wired together by **typed signals**. You orchestrate work by wiring the graph — not by standing up an event bus.

Instead of an event bus that broadcasts to whoever happens to be listening, CNStra keeps the flow explicit. You start a run with `cns.stimulate(signal)`, and it walks the graph deterministically — one hop at a time, `collateral → dendrite → returned signal` — until nothing is left to fire. A neuron receives a signal on one of its dendrites, does its work, and returns the next signal; that returned signal **is** the edge to the next neuron. No hidden subscribers, no fan-out you can't trace.

Four primitives:

- **Collateral** — a typed channel; a signal is a payload sent on one.
- **Neuron** — a unit of logic with one or more dendrites.
- **Dendrite** — a handler that reacts to a collateral and returns the next signal.
- **Signal** — what actually flows through a run.

Because traversal is deterministic and hop-bounded, a run is reproducible and easy to reason about — which is what makes CNStra a good fit for:

- **Jobs & workers**, **webhooks & integrations**, **ETL / pipelines**
- **Retries, timeouts, cancellation**, and **saga-style compensations**

Zero dependencies. No pub/sub. In-memory.

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

**CNS + registry from one map:** if you're going to build both, `createCNS` lists the
neuron set once and returns both — they derive from the same map, so the names can never
drift from the runtime graph. Accepts the same explicit-name syntax as `createPersistRegistry`.

```ts
import { createCNS } from '@cnstra/core';

const { cns, registry } = createCNS({ deckNeuron, cardNeuron });
// `cns` is the runtime engine; `registry` carries the names for devtools/mcp/persistence.
// Don't need naming/persistence? Just use `new CNS([deckNeuron, cardNeuron])` directly.
```

## Documentation

- **[Quick Start Guide](https://cnstra.org/docs/core/quick-start)** — Get up and running in minutes
- **[API Reference](https://cnstra.org/docs/core/api)** — Complete API documentation
- **[Concepts](https://cnstra.org/docs/core/concepts)** — Neurons, collaterals, signals, and the CNS model (Central Neural Network of your app)
- **[Recipes](https://cnstra.org/docs/recipes)** — Common patterns and use cases
- **[Advanced Topics](https://cnstra.org/docs/advanced)** — Performance, context stores, integrations

---

*CNStra provides deterministic, type-safe orchestration without the complexity of traditional event systems.*
