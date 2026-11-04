import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { entriesOf, leaksOf } from './check-dist-imports.mjs';

describe('entriesOf', () => {
    test('checks every subpath under each module system its conditions declare', () => {
        const entries = entriesOf({
            name: '@cnstra/pg-boss',
            exports: {
                '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.js' },
                './postgres-progress': { import: './dist/pp.mjs' },
            },
        });
        assert.deepEqual(entries, [
            { specifier: '@cnstra/pg-boss', mode: 'import' },
            { specifier: '@cnstra/pg-boss', mode: 'require' },
            { specifier: '@cnstra/pg-boss/postgres-progress', mode: 'import' },
        ]);
    });

    test('skips a stylesheet export, which no module system loads', () => {
        const entries = entriesOf({
            name: '@cnstra/devtools-panel-ui',
            type: 'module',
            exports: { './embed': { import: './dist/lib/panel.js' }, './embed.css': './dist/lib/panel.css' },
        });
        assert.deepEqual(entries, [{ specifier: '@cnstra/devtools-panel-ui/embed', mode: 'import' }]);
    });

    test('finds conditions nested under another condition', () => {
        const entries = entriesOf({
            name: 'x',
            exports: { '.': { node: { import: './a.mjs', require: './a.cjs' } } },
        });
        assert.deepEqual(entries.map(e => e.mode), ['import', 'require']);
    });

    test('reads a conditions object given without subpaths as the root entry', () => {
        const entries = entriesOf({ name: 'x', exports: { import: './a.mjs' } });
        assert.deepEqual(entries, [{ specifier: 'x', mode: 'import' }]);
    });

    test('loads a main-only package the way its type says', () => {
        assert.deepEqual(entriesOf({ name: 'x', main: 'dist/index.js' }), [{ specifier: 'x', mode: 'require' }]);
        assert.deepEqual(entriesOf({ name: 'x', type: 'module', main: 'dist/index.js' }), [{ specifier: 'x', mode: 'import' }]);
    });

    test('skips a package with no entry point, wildcard subpaths, package.json and jest-only entries', () => {
        assert.deepEqual(entriesOf({ name: '@cnstra/devtools-panel-ui', files: ['dist'] }), []);
        const entries = entriesOf({
            name: '@cnstra/jobs',
            exports: {
                '.': { import: './dist/index.mjs' },
                './testing': { import: './dist/testing/index.mjs' },
                './*': './dist/*.js',
                './package.json': './package.json',
            },
        });
        assert.deepEqual(entries, [{ specifier: '@cnstra/jobs', mode: 'import' }]);
    });
});

describe('leaksOf', () => {
    const privateNames = new Set(['@cnstra/postgres-schema']);

    test('reports a private package in the dependencies of a public one', () => {
        const problems = leaksOf({
            manifest: { name: '@cnstra/jobs-postgres', dependencies: { '@cnstra/postgres-schema': '0.1.0' }, devDependencies: { '@cnstra/postgres-schema': '0.1.0' } },
            files: [],
            privateNames,
            exists: () => true,
        });
        assert.deepEqual(problems, ['@cnstra/jobs-postgres lists the private package @cnstra/postgres-schema in dependencies']);
    });

    test('reports dist code that still imports the private package', () => {
        const problems = leaksOf({
            manifest: { name: 'x' },
            files: [{ path: '/p/dist/index.js', text: 'const m = require("@cnstra/postgres-schema");' }],
            privateNames,
            exists: () => true,
        });
        assert.deepEqual(problems, ['/p/dist/index.js imports the private package @cnstra/postgres-schema']);
    });

    test('reports a declaration file that imports a file missing from dist', () => {
        const present = new Set(['/p/dist/types/TKnown.d.ts']);
        const problems = leaksOf({
            manifest: { name: 'x' },
            files: [{ path: '/p/dist/index.d.ts', text: "import { A } from './types/TMissing';\nimport { B } from './types/TKnown';\n * import { cns } from './src/cns';" }],
            privateNames,
            exists: path => present.has(path),
        });
        assert.deepEqual(problems, ['/p/dist/index.d.ts imports ./types/TMissing, which is not in dist']);
    });
});
