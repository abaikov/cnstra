---
id: devtools-mcp
title: MCP Server — AI Graph Inspection
sidebar_label: MCP Server
slug: /devtools/mcp
description: Give Claude and Cursor instant understanding of your CNStra neuron graph via MCP (Model Context Protocol).
keywords: [MCP, Claude, Cursor, AI, neuron graph, Model Context Protocol, cns_get_graph, cns_list_neurons, CNSPersistOptionsRegistry]
---

`@cnstra/mcp` is an MCP server that gives AI tools (Claude Code, Cursor, VS Code, Windsurf) live access to your neuron graph. It uses the same registry you create with `CNSPersistOptionsRegistryFactory` from `@cnstra/persist` — one file, one line.

Tools exposed:
- **`cns_get_context`** — START HERE: CNStra concept guide + neuron list
- **`cns_get_graph`** — full architecture with all connections
- **`cns_get_neuron`** — deep dive into one neuron
- **`cns_list_neurons`** — quick overview of all neurons
- **`cns_list_collaterals`** — all collaterals with owners and subscribers

## Setup

### 1. Install

```bash
npm i -D @cnstra/mcp
```

### 2. Create cns-mcp.ts

First, create a registry. Two options:

**Option A — per-file (recommended for larger projects):**
```ts
// src/neurons/registry.ts
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
export const registry = new CNSPersistOptionsRegistry();

// src/neurons/deck.ts — each neuron registers itself
import { registry } from './registry';
registry
    .register('deckNeuron', deckNeuron)
    .register('cardNeuron', cardNeuron, { deckCreated: 'deck-created' }) // explicit collateral names
    .registerCollateral('userLogin', userLogin); // standalone collateral (no neuron owner)
```

**Option B — all at once (simpler for small projects):**
```ts
// src/neurons/registry.ts
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { deckNeuron, cardNeuron, uiNeuron } from './index';

export const registry = CNSPersistOptionsRegistryFactory.create({ deckNeuron, cardNeuron, uiNeuron });
```

Then the MCP entry point:

```ts
// cns-mcp.ts  ← dev-only, not imported from prod entry point
import { startCNSMCPServer } from '@cnstra/mcp';
import { cns } from './src/cns';
import { registry } from './src/neurons/registry';

await startCNSMCPServer(cns, registry);
```

### 3. Run init to register with all AI tools

```bash
npx @cnstra/mcp init
```

Writes MCP config for every tool found in the project:

| Tool | Config file |
|------|-------------|
| Claude Code | `.claude/settings.json` → `mcpServers` |
| Cursor | `.cursor/mcp.json` → `mcpServers` |
| VS Code | `.vscode/mcp.json` → `servers` |
| Windsurf | `.windsurf/mcp.json` → `mcpServers` |

After `init`, open the project in any of these tools — the MCP server starts automatically.

## What the AI gets

The server exposes three MCP mechanisms — tools that support any subset will benefit:

**Resources** (auto-loaded on connect in tools that support them):
- `cnstra://context` — concepts, rules, neuron list
- `cnstra://graph` — full neuron graph

**Prompts** (slash-commands / @ references):
- `understand_project` — context + full graph in one shot

**Tools** (called on demand):
- `cns_get_context`, `cns_get_graph`, `cns_get_neuron`, `cns_list_neurons`, `cns_list_collaterals`

### Example: cns_get_graph output

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

## Zero prod overhead

`@cnstra/mcp` is a dev dependency. `cns-mcp.ts` is never imported in production. The MCP server process only runs when an AI tool starts it.
