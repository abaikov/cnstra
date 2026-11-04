# @cnstra/core

**Orchestration engine for TypeScript — deterministic, embeddable, in-memory.**

📚 **[Full Documentation →](https://cnstra.org/)** | [Quick Start](https://cnstra.org/docs/core/quick-start) | [API Reference](https://cnstra.org/docs/core/api) | [Recipes](https://cnstra.org/docs/recipes/saga)

## What is CNStra?

**CNStra** (Central Nervous System Orchestrator) is a library for control flow you can read, type-check, and resume.

You wire your app's steps into a graph and start a run with a signal. CNStra walks that graph deterministically, one hop at a time — and every hop is visible while it runs and re-drivable after it fails. It's a library, not a service: no server, no broker, no database to stand up, and no third-party dependencies.

**Isolated units.** A neuron owns one responsibility. Change it and the compiler plus the graph show exactly what it affects — no hidden coupling to grep for, no subscriber you didn't wire yourself.

**Typed, and exhaustive.** Signals travel on typed collaterals, and the compiler makes you handle every collateral you subscribe to. An incomplete flow doesn't build.

**Traceable and resumable.** Devtools show every hop of every run and let you retry one. `@cnstra/persist` records what a run still has left to do, so a process that dies halfway comes back with exactly the unfinished work — not with the whole flow replayed.

Which makes it a good fit for:

- **Jobs & workers**, **webhooks & integrations**, **ETL / pipelines**
- **Retries, timeouts, cancellation**, and **saga-style compensations**

### The four primitives

- **Collateral** — a typed channel; a signal is a payload sent on one.
- **Neuron** — a unit of logic with one or more dendrites.
- **Dendrite** — a handler that reacts to a collateral and returns the next signal.
- **Signal** — what actually flows through a run.

A dendrite's returned signal **is** the edge to the next neuron. That's the entire wiring model.

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

`CNSPersistOptionsRegistry` (from `@cnstra/persist`) maps object references to stable string names — used by devtools, MCP server, and persistence/resume patterns.

**Per-file registration (recommended):**

```ts file=registry.ts
// src/neurons/registry.ts
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
export const registry = new CNSPersistOptionsRegistry();
```

```ts file=deck.ts
// src/neurons/deck.ts — each neuron registers itself
import { collateral, neuron } from '@cnstra/core';
import { registry } from './registry';

const deckCreated = collateral<{ deckId: string }>();
const importStarted = collateral<{ importId: string }>(); // external entry point

const deckNeuron = neuron({ deckCreated })
    .bind({ importStarted }, {
        importStarted: ({ importId }, axon) => axon.deckCreated.createSignal({ deckId: importId }),
    });

registry
    .register('deckNeuron', deckNeuron, { deckCreated: 'deck-created' }) // neuron + axon collaterals; default name 'deckNeuron.deckCreated'
    .registerCollateral('importStarted', importStarted);   // standalone collateral (no neuron)
```

**All at once (simple projects):**

```ts setup
import type { TCNSNeuron } from '@cnstra/types';

declare const deckNeuron: TCNSNeuron<any>;
declare const cardNeuron: TCNSNeuron<any>;
```

```ts
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';

export const registry = CNSPersistOptionsRegistryFactory.create({ deckNeuron, cardNeuron });
// explicit neuron name:        { 'deck-neuron': deckNeuron }
// explicit collateral names:   { 'deck-neuron': { neuron: deckNeuron, collaterals: { deckCreated: 'deck-created' } } }
// entry collaterals and modalities go in the same object; a nested object is a namespace: { decks: { deckNeuron } } → 'decks.deckNeuron'
```

**CNS + registry from one map:** if you're going to build both, `CNSFactory.create` from `@cnstra/factory` lists the
neuron set once and returns both — they derive from the same map, so the names can never
drift from the runtime graph. Accepts the same explicit-name syntax as `CNSPersistOptionsRegistryFactory.create`.

```ts
import { CNSFactory } from '@cnstra/factory';

const { cns, registry } = CNSFactory.create({ deckNeuron, cardNeuron });
// `cns` is the runtime engine; `registry` carries the names for devtools/mcp/persistence.
// Don't need naming/persistence? `new CNS([deckNeuron, cardNeuron])`, or `createCNS(neuronFactories, dependencies)` when the neurons have dependencies.
```

**Neurons with dependencies (recommended):** write each neuron as a factory of its dependencies, in its own file, and build the CNS with `createCNS(neuronFactories, dependencies)`. Every factory gets the same dependencies, and TypeScript checks them against each factory's parameter. See [Dependencies](https://cnstra.org/docs/core/api#dependencies-a-store-a-database-a-clock).

## Documentation

- **[Quick Start Guide](https://cnstra.org/docs/core/quick-start)** — Get up and running in minutes
- **[API Reference](https://cnstra.org/docs/core/api)** — Complete API documentation
- **[Concepts](https://cnstra.org/docs/concepts/basics)** — Neurons, collaterals, signals, and the CNS model (Central Neural Network of your app)
- **[Recipes](https://cnstra.org/docs/recipes/saga)** — Common patterns and use cases
- **[Advanced Topics](https://cnstra.org/docs/advanced/performance)** — Performance, integrations

---

*CNStra provides deterministic, type-safe orchestration without the complexity of traditional event systems.*
