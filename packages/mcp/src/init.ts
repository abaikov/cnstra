#!/usr/bin/env node
/**
 * npx @cnstra/mcp init
 *
 * Generates cns-mcp.ts and registers the MCP server in every AI tool
 * config found: Claude Code, Cursor, VS Code, Windsurf.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import * as readline from 'readline';

const cwd = process.cwd();

const AI_TOOLS = [
    { tool: 'Claude Code', dir: '.claude',   file: 'settings.json', key: 'mcpServers' },
    { tool: 'Cursor',      dir: '.cursor',   file: 'mcp.json',      key: 'mcpServers' },
    { tool: 'VS Code',     dir: '.vscode',   file: 'mcp.json',      key: 'servers'    },
    { tool: 'Windsurf',    dir: '.windsurf', file: 'mcp.json',      key: 'mcpServers' },
];

function ask(rl: readline.Interface, q: string, fallback: string): Promise<string> {
    return new Promise(res => rl.question(`${q} (${fallback}): `, a => res(a.trim() || fallback)));
}

function readJson(path: string): Record<string, unknown> {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function upsertMcp(dir: string, file: string, key: string, entry: unknown): void {
    const fullDir = join(cwd, dir);
    const fullPath = join(fullDir, file);
    if (!existsSync(fullDir)) mkdirSync(fullDir, { recursive: true });
    const cfg = readJson(fullPath);
    cfg[key] = { ...((cfg[key] as Record<string, unknown>) ?? {}), cnstra: entry };
    writeFileSync(fullPath, JSON.stringify(cfg, null, 2) + '\n');
}

async function main() {
    console.log('\n🧠 CNStra MCP init\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const mcpFileName  = await ask(rl, 'MCP entry file name', 'cns-mcp.ts');
    const cnsPath      = await ask(rl, 'Import path for your CNS instance', './src/cns');
    const registryPath = await ask(rl, 'Import path for your CNSPersistOptionsRegistry', './src/neurons/registry');
    const runner       = await ask(rl, 'Script runner (tsx / ts-node)', 'tsx');
    rl.close();
    console.log('');

    // Generate cns-mcp.ts
    const mcpFilePath = resolve(cwd, mcpFileName);
    if (existsSync(mcpFilePath)) {
        console.log(`  ⚠  ${mcpFileName} already exists — skipping`);
    } else {
        writeFileSync(mcpFilePath, `import { startCNSMCPServer } from '@cnstra/mcp';
import { cns } from '${cnsPath}';
import { registry } from '${registryPath}';

await startCNSMCPServer(cns, registry);
`);
        console.log(`  ✓  Created ${mcpFileName}`);
    }

    // Generate .cursor/rules/cnstra.md (Cursor reads these automatically)
    const cursorRulesDir = join(cwd, '.cursor', 'rules');
    const cursorRulesPath = join(cursorRulesDir, 'cnstra.md');
    if (!existsSync(cursorRulesPath)) {
        mkdirSync(cursorRulesDir, { recursive: true });
        writeFileSync(cursorRulesPath, `# CNStra

This project uses CNStra for typed orchestration.
The MCP server starts automatically — call \`cns_get_context\` first, then \`cns_get_graph\`.

Key rules:
- One domain model → one neuron (only it mutates that model)
- Collaterals are past events: \`deckCreated\`, not \`createDeck\`
- Neuron code = mutations only; I/O → auxiliary neurons
- Use \`neuron.bind(axon, handlers)\` for exhaustive compile-time safety

Full docs: https://cnstra.org/llms-full.txt
`);
        console.log(`  ✓  Cursor rules: .cursor/rules/cnstra.md`);
    }

    // Register in AI tool configs
    const mcpEntry = { command: 'npx', args: [runner, mcpFileName] };
    for (const { tool, dir, file, key } of AI_TOOLS) {
        if (existsSync(join(cwd, dir)) || tool === 'Claude Code') {
            upsertMcp(dir, file, key, mcpEntry);
            console.log(`  ✓  ${tool}: ${dir}/${file}`);
        }
    }

    console.log(`
─────────────────────────────────────────────────────
Add this to CLAUDE.md in your project root:
─────────────────────────────────────────────────────

## CNStra

This project uses CNStra for typed orchestration.
MCP server starts automatically — call \`cns_get_context\` first, then \`cns_get_graph\`.

Key rules:
- One domain model → one neuron
- Collaterals are past events: \`deckCreated\`, not \`createDeck\`
- Neuron code = mutations only

Docs: https://cnstra.org/llms-full.txt

─────────────────────────────────────────────────────

Done. Open the project in Claude Code or Cursor — MCP starts automatically.
`);
}

main().catch(err => { console.error(err); process.exit(1); });
