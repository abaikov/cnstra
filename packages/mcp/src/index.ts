import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { ICNS, TCNSNeuron } from '@cnstra/types';

type AnyNeuron = TCNSNeuron<any, any>;
type AnyCollateral = CNSCollateral<unknown>;

export type CNSMCPServerOptions = {
    /** Server name shown to the AI tool. Default: 'cnstra' */
    name?: string;
    /** Server version. Default: '1.0.0' */
    version?: string;
};

// ─── Graph helpers ────────────────────────────────────────────────────────────

function resolveSubscribers(
    cns: ICNS<AnyNeuron>,
    col: AnyCollateral,
    registry: CNSPersistOptionsRegistry
): string[] {
    return cns.network
        .getSubscribers(col)
        .map(s => registry.getNeuronName(s.neuron as AnyNeuron) ?? '?');
}

function collateralName(col: AnyCollateral, registry: CNSPersistOptionsRegistry): string {
    return registry.getCollateralName(col) ?? '(unknown)';
}

// ─── Tool implementations ─────────────────────────────────────────────────────

function toolGetContext(cns: ICNS<AnyNeuron>, registry: CNSPersistOptionsRegistry): string {
    const named = registry.getNamedNeurons();
    const neuronList = [...named.keys()].map(n => `  - ${n}`).join('\n');
    const collateralCount = [...named.values()]
        .reduce((sum, n) => sum + Object.keys(n.axon).length, 0);

    return `# CNStra — Project Context

## What is CNStra
CNStra is a typed orchestration library. The app is modeled as a neuron graph:
- **Neuron** — owns one domain model's mutations. Only it writes to that model.
- **Collateral** — a typed output channel. Named in past tense: \`deckCreated\`, not \`createDeck\`.
- **Dendrite** — an input binding. Declares which collateral a neuron reacts to.
- **Stimulation** — one run through the graph: \`cns.stimulate(signal)\`.
- **Axon** — the set of collaterals a neuron can emit.

## Key architecture rules
1. **One model → one neuron.** All mutations of a domain entity live in its owning neuron.
2. **Collaterals are past events.** They describe what happened, not what to do.
3. **Keep afferent paths separate.** Don't merge multiple trigger sources into one "intent" collateral — you lose traceability.
4. **Neuron code = mutations only.** Mappings go to utility functions. Concurrent I/O goes to auxiliary neurons.
5. **Exhaustive binding.** Use \`neuron.bind(axon, handlers)\` to get compile-time safety when a neuron must handle every collateral of another neuron's axon.

## This project
Neurons: ${named.size} | Collaterals: ${collateralCount}

${neuronList}

Call \`cns_get_graph\` for the full architecture with all connections.
Call \`cns_get_neuron\` with a name for details on a specific neuron.

## Full documentation
https://cnstra.org/llms-full.txt`;
}

function toolGetGraph(cns: ICNS<AnyNeuron>, registry: CNSPersistOptionsRegistry): string {
    const named = registry.getNamedNeurons();
    const lines: string[] = ['# CNS Graph', ''];

    for (const [name, neuron] of named) {
        lines.push(`## ${name}`, '');

        const axonEntries = Object.entries(neuron.axon);
        if (axonEntries.length > 0) {
            lines.push('**Emits:**');
            for (const [key, col] of axonEntries) {
                const colName = collateralName(col as AnyCollateral, registry) !== '(unknown)'
                    ? collateralName(col as AnyCollateral, registry)
                    : key;
                const subs = resolveSubscribers(cns, col as AnyCollateral, registry).join(', ');
                lines.push(subs ? `  - \`${colName}\` → ${subs}` : `  - \`${colName}\``);
            }
            lines.push('');
        }

        if (neuron.dendrites.length > 0) {
            lines.push('**Reacts to:**');
            for (const dendrite of neuron.dendrites) {
                const col = dendrite.collateral as AnyCollateral;
                const colName = collateralName(col, registry);
                const owner = cns.network.getParentNeuronByCollateral(col);
                const ownerName = owner
                    ? (registry.getNeuronName(owner as AnyNeuron) ?? '?')
                    : '(external)';
                lines.push(`  - \`${colName}\` from **${ownerName}**`);
            }
            lines.push('');
        }
    }
    return lines.join('\n');
}

function toolListNeurons(registry: CNSPersistOptionsRegistry): string {
    const named = registry.getNamedNeurons();
    const lines = ['# Neurons', ''];
    for (const [name, neuron] of named) {
        const emits = Object.keys(neuron.axon).join(', ') || '—';
        lines.push(`- **${name}** — emits: ${emits} | dendrites: ${neuron.dendrites.length}`);
    }
    return lines.join('\n');
}

function toolGetNeuron(
    cns: ICNS<AnyNeuron>,
    registry: CNSPersistOptionsRegistry,
    neuronName: string
): string {
    const neuron = registry.getNeuron(neuronName) as AnyNeuron | undefined;
    if (!neuron) {
        const available = [...registry.getNamedNeurons().keys()].join(', ');
        return `Neuron "${neuronName}" not found. Available: ${available}`;
    }

    const lines = [`# ${neuronName}`, ''];

    const axonEntries = Object.entries(neuron.axon);
    if (axonEntries.length > 0) {
        lines.push('## Emits');
        for (const [key, col] of axonEntries) {
            const colName = collateralName(col as AnyCollateral, registry) !== '(unknown)'
                ? collateralName(col as AnyCollateral, registry)
                : key;
            const subs = resolveSubscribers(cns, col as AnyCollateral, registry);
            lines.push(
                subs.length
                    ? `- \`${colName}\` → consumed by: ${subs.join(', ')}`
                    : `- \`${colName}\` (no subscribers)`
            );
        }
        lines.push('');
    }

    if (neuron.dendrites.length > 0) {
        lines.push('## Reacts to');
        for (const dendrite of neuron.dendrites) {
            const col = dendrite.collateral as AnyCollateral;
            const colName = collateralName(col, registry);
            const owner = cns.network.getParentNeuronByCollateral(col);
            const ownerName = owner
                ? (registry.getNeuronName(owner as AnyNeuron) ?? '?')
                : '(external)';
            lines.push(`- \`${colName}\` from **${ownerName}**`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

function toolListCollaterals(cns: ICNS<AnyNeuron>, registry: CNSPersistOptionsRegistry): string {
    const named = registry.getNamedNeurons();
    const lines = ['# Collaterals', ''];
    for (const [, neuron] of named) {
        const ownerName = registry.getNeuronName(neuron as AnyNeuron) ?? '?';
        for (const [key, col] of Object.entries(neuron.axon)) {
            const colName = collateralName(col as AnyCollateral, registry) !== '(unknown)'
                ? collateralName(col as AnyCollateral, registry)
                : key;
            const subs = resolveSubscribers(cns, col as AnyCollateral, registry);
            lines.push(`- \`${colName}\` (owner: **${ownerName}**) → ${subs.join(', ') || 'no subscribers'}`);
        }
    }
    return lines.join('\n');
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'cns_get_context',
        description: 'START HERE. CNStra concept guide + list of neurons in this project.',
        inputSchema: { type: 'object' as const, properties: {} },
    },
    {
        name: 'cns_get_graph',
        description: 'Full neuron graph: what each neuron emits (with subscribers) and reacts to.',
        inputSchema: { type: 'object' as const, properties: {} },
    },
    {
        name: 'cns_list_neurons',
        description: 'One-line summary of all neurons: emitted collaterals and dendrite count.',
        inputSchema: { type: 'object' as const, properties: {} },
    },
    {
        name: 'cns_get_neuron',
        description: 'Detailed info about one neuron: full axon with subscriber list and all dendrites.',
        inputSchema: {
            type: 'object' as const,
            properties: { name: { type: 'string', description: 'Neuron name, e.g. "deckNeuron"' } },
            required: ['name'],
        },
    },
    {
        name: 'cns_list_collaterals',
        description: 'All collaterals with owner neuron and subscriber list.',
        inputSchema: { type: 'object' as const, properties: {} },
    },
];

// ─── Server ───────────────────────────────────────────────────────────────────

/**
 * Starts an MCP server on stdio that exposes the CNS graph to AI tools
 * (Claude Code, Cursor, VS Code, Windsurf, and any other MCP-compatible tool).
 *
 * Pass a CNSPersistOptionsRegistry that already has your neurons registered —
 * the same registry you use for devtools.
 *
 * @example
 * // cns-mcp.ts
 * import { startCNSMCPServer } from '@cnstra/mcp';
 * import { cns } from './src/cns';
 * import { registry } from './src/neurons/registry'; // your CNSPersistOptionsRegistry
 *
 * await startCNSMCPServer(cns, registry);
 *
 * // .claude/settings.json (and .cursor/mcp.json etc — run `npx @cnstra/mcp init`):
 * // { "mcpServers": { "cnstra": { "command": "npx", "args": ["tsx", "cns-mcp.ts"] } } }
 */
export async function startCNSMCPServer(
    cns: ICNS<AnyNeuron>,
    registry: CNSPersistOptionsRegistry,
    options: CNSMCPServerOptions = {}
): Promise<void> {
    const server = new Server(
        { name: options.name ?? 'cnstra', version: options.version ?? '1.0.0' },
        { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Resources — auto-loaded by tools that support MCP resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            {
                uri: 'cnstra://context',
                name: 'CNStra — project context & rules',
                description: 'Core concepts, key rules, and neuron list. Read this first.',
                mimeType: 'text/markdown',
            },
            {
                uri: 'cnstra://graph',
                name: 'CNS neuron graph',
                description: 'Full graph: every neuron, emitted collaterals, and dendrite bindings.',
                mimeType: 'text/markdown',
            },
        ],
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
        const text =
            req.params.uri === 'cnstra://context' ? toolGetContext(cns, registry) :
            req.params.uri === 'cnstra://graph'   ? toolGetGraph(cns, registry) :
            `Unknown resource: ${req.params.uri}`;
        return { contents: [{ uri: req.params.uri, mimeType: 'text/markdown', text }] };
    });

    // Prompts — slash-commands / @ references in tools that support them
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: [{
            name: 'understand_project',
            description: 'Full briefing on this CNStra project: concepts, rules, and complete neuron graph.',
        }],
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (req) => {
        if (req.params.name !== 'understand_project') return { messages: [] };
        return {
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: toolGetContext(cns, registry) + '\n\n---\n\n' + toolGetGraph(cns, registry),
                },
            }],
        };
    });

    // Tools — called on demand
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args } = req.params;
        let text: string;
        switch (name) {
            case 'cns_get_context':    text = toolGetContext(cns, registry); break;
            case 'cns_get_graph':      text = toolGetGraph(cns, registry); break;
            case 'cns_list_neurons':   text = toolListNeurons(registry); break;
            case 'cns_get_neuron':     text = toolGetNeuron(cns, registry, (args as any)?.name ?? ''); break;
            case 'cns_list_collaterals': text = toolListCollaterals(cns, registry); break;
            default: text = `Unknown tool: ${name}`;
        }
        return { content: [{ type: 'text', text }] };
    });

    await server.connect(new StdioServerTransport());
}
