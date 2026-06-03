#!/usr/bin/env node
/**
 * Generates docs/static/llms-full.txt — a single file with all doc pages
 * concatenated for AI consumption. Run: node scripts/generate-llms-full.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const DOCS_ROOT = new URL('../docs', import.meta.url).pathname;
const OUTPUT = join(DOCS_ROOT, 'static', 'llms-full.txt');
const BASE_URL = 'https://cnstra.org/docs';

const ORDER = [
    'concepts/intro.md',
    'core/overview.md',
    'core/quick-start.md',
    'core/api.md',
    'core/stimulation-options.md',
    'concepts/basics.md',
    'concepts/workflow-engine-comparison.md',
    'frontend/oimdb.md',
    'frontend/react-patterns.md',
    'frontend/redux-migration.md',
    'frontend/benchmark.md',
    'backend/overview.md',
    'backend/cqrs.md',
    'advanced/best-practices.md',
    'advanced/performance.md',
    'advanced/persistence.md',
    'advanced/custom-context-store.md',
    'advanced/common-issues.md',
    'recipes/cancel.md',
    'recipes/retry.md',
    'recipes/retry-stimulation.md',
    'recipes/error-handling.md',
    'recipes/saga.md',
    'recipes/multiple-signals.md',
    'recipes/response-listeners.md',
    'recipes/flow-inheritance.md',
    'recipes/self-loop-cycles.md',
    'recipes/stimulation-gate.md',
    'recipes/exhaustive-binding.md',
    'recipes/testing.md',
    'integrations/message-brokers.md',
    'ecosystem/swift-sdk.md',
    'devtools/overview.md',
    'devtools/integration.md',
    'devtools/mcp.md',
    'devtools/ai-inspection.md',
    'devtools/advanced.md',
    'devtools/download.md',
];

function stripFrontmatter(content) {
    return content.replace(/^---[\s\S]*?---\n/, '').trim();
}

function fileToUrl(relativePath) {
    const withoutExt = relativePath.replace(/\.md$/, '');
    return `${BASE_URL}/${withoutExt}`;
}

const chunks = [
    readFileSync(join(DOCS_ROOT, 'static', 'llms.txt'), 'utf8'),
    '\n---\n',
];

for (const relPath of ORDER) {
    const fullPath = join(DOCS_ROOT, relPath);
    let content;
    try {
        content = readFileSync(fullPath, 'utf8');
    } catch {
        console.warn(`Missing: ${relPath}`);
        continue;
    }
    const url = fileToUrl(relPath);
    const body = stripFrontmatter(content);
    chunks.push(`\n# Source: ${url}\n\n${body}\n`);
}

writeFileSync(OUTPUT, chunks.join('\n'));
console.log(`Written: ${relative(process.cwd(), OUTPUT)} (${Math.round(chunks.join('\n').length / 1024)} KB)`);
