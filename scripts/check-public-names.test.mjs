import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = new URL('../packages', import.meta.url).pathname;

const exportedValueNamesOf = source => {
    const names = [];
    for (const [, list] of source.matchAll(/export\s+\{([^}]*)\}/g)) {
        for (const specifier of list.split(',')) {
            const name = specifier.trim().split(/\s+as\s+/).pop()?.trim();
            if (name && !name.startsWith('type ')) names.push(name);
        }
    }
    for (const [, name] of source.matchAll(/export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.push(name);
    return names;
};

test('no public helper of a package is named with a lowercase cns prefix: neuron, not cnsNeuron', () => {
    const offenders = [];
    for (const directory of readdirSync(PACKAGES)) {
        const manifestPath = join(PACKAGES, directory, 'package.json');
        const indexPath = join(PACKAGES, directory, 'src', 'index.ts');
        if (!existsSync(manifestPath) || !existsSync(indexPath)) continue;
        if (JSON.parse(readFileSync(manifestPath, 'utf8')).private) continue;
        const source = readFileSync(indexPath, 'utf8').replace(/export\s+type\s+\{[^}]*\}/g, '');
        for (const name of exportedValueNamesOf(source)) {
            if (/^cns[A-Z]/.test(name)) offenders.push(`${directory}: ${name}`);
        }
    }
    assert.deepEqual(offenders, []);
});
