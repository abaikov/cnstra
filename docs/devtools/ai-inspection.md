---
id: devtools-ai-inspection
title: AI Graph Inspection
sidebar_label: AI Inspection
slug: /devtools/ai-inspection
description: How to export the CNStra neuron graph and runtime history so AI tools (Claude, Cursor) can instantly understand your application architecture.
keywords: [AI, Claude, Cursor, graph, inspection, neuron graph, CNS graph, history, dumpCNSGraph, CNSHistoryLogger, CNSPersistOptionsRegistry]
---

AI tools like Claude and Cursor understand your CNStra application much better when they can read the neuron graph and runtime history as plain text — instead of parsing dozens of source files.

`@cnstra/devtools` exports two utilities for this: `dumpCNSGraph` and `CNSHistoryLogger`. Both take a registry created with `CNSPersistOptionsRegistryFactory` — one line, no boilerplate.

## Static graph dump

`dumpCNSGraph` produces a Markdown description of your neuron graph: which collaterals each neuron emits, where those collaterals go, and what each neuron reacts to.

```ts
// cns.debug.ts  ← excluded from your prod entry point
import { writeFileSync } from 'fs';
import { dumpCNSGraph } from '@cnstra/devtools';
import { cns } from './cns';
import { registry } from './src/neurons/registry'; // your CNSPersistOptionsRegistry

writeFileSync('CNS_GRAPH.md', dumpCNSGraph(cns, registry));
```

If you don't have a shared registry yet, create one inline:

```ts
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
const registry = CNSPersistOptionsRegistryFactory.create({ deckNeuron, cardNeuron, uiNeuron });
writeFileSync('CNS_GRAPH.md', dumpCNSGraph(cns, registry));
```

Add a script to `package.json`:

```json
{ "scripts": { "graph": "tsx cns.debug.ts" } }
```

Run `npm run graph` whenever your neuron structure changes. Commit `CNS_GRAPH.md` — AI tools will pick it up automatically.

### Example output

```markdown
# CNS Graph

## deckNeuron

**Emits:**
  - `createdAtButtonClick` → cardNeuron
  - `createdAtOnboarding` → cardNeuron
  - `renamed`
  - `archived`

**Reacts to:**
  - `createDeckButtonClicked` from **uiNeuron**
  - `userOnboarded` from **onboardingNeuron**
```

## Runtime history

`CNSHistoryLogger` subscribes to a CNS instance and records the stimulation history.

```ts
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { CNSHistoryLogger } from '@cnstra/devtools';
import { cns } from './cns';
import { deckNeuron, cardNeuron } from './neurons';

const registry = CNSPersistOptionsRegistryFactory.create({ deckNeuron, cardNeuron });

const logger = new CNSHistoryLogger(cns, registry);

// ... run your app, trigger some flows ...

console.log(logger.dump());
// or: writeFileSync('CNS_HISTORY.md', logger.dump());

logger.stop();
```

### Options

```ts
new CNSHistoryLogger(cns, registry, {
    maxRecords: 50, // keep last N stimulations (default: 100)
});
```

### Example output

```markdown
# CNS History

### #3 · 12:00:05.234
triggered by: `userOnboarded`
  - `userOnboarded` → `createdAtOnboarding`
  - `createdAtOnboarding` → `createdAtOnboarding`

### #2 · 12:00:02.100
triggered by: `createDeckButtonClicked`
  - `createDeckButtonClicked` → `createdAtButtonClick`
```

## Zero prod overhead

Both utilities are in `@cnstra/devtools` (dev dependency). As long as `cns.debug.ts` is not in your production entry point, they are fully tree-shaken.

For live AI access to the graph without generating files, see the [MCP Server](/docs/devtools/mcp).
