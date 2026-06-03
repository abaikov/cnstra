# @cnstra/mcp

MCP server for CNStra — gives Claude Code, Cursor, VS Code and Windsurf live access to your neuron graph.

## Setup

```bash
npm i -D @cnstra/mcp
npx @cnstra/mcp init
```

`init` does three things:
1. Generates `cns-mcp.ts` (the server entry point)
2. Writes MCP config for every AI tool found in the project
3. Prints a `CLAUDE.md` snippet to paste into your project

Then wire up your CNS instance and registry in `cns-mcp.ts`:

```ts
import { startCNSMCPServer } from '@cnstra/mcp';
import { cns } from './src/cns';
import { registry } from './src/neurons/registry'; // CNSPersistOptionsRegistry

await startCNSMCPServer(cns, registry);
```

The registry maps neurons and collaterals to stable names. Use per-file registration:

```ts
// src/neurons/registry.ts
import { CNSPersistOptionsRegistry } from '@cnstra/core';
export const registry = new CNSPersistOptionsRegistry();

// src/neurons/deck.ts
import { registry } from './registry';
registry
    .register('deckNeuron', deckNeuron)
    .registerCollateral('importStarted', importStarted);
```

Or `createPersistRegistry` for simple projects:

```ts
import { createPersistRegistry } from '@cnstra/core';
export const registry = createPersistRegistry({ deckNeuron, cardNeuron });
```

Open the project in Claude Code or Cursor — the server starts automatically.

## Tools available to the AI

| Tool | What it returns |
|------|----------------|
| `cns_get_context` | CNStra concept guide + neuron list (start here) |
| `cns_get_graph` | Full graph: every neuron, what it emits and reacts to |
| `cns_get_neuron` | Details on one specific neuron |
| `cns_list_neurons` | One-line summary of all neurons |
| `cns_list_collaterals` | All collaterals with owners and subscribers |

Full docs: https://cnstra.org/docs/devtools/mcp
