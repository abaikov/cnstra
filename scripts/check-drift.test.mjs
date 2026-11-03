/**
 * Tests for the release gate. Run with `npm run test:scripts`.
 *
 * Uses node's built-in test runner rather than jest: these are plain ESM scripts
 * outside every workspace, and `node --test` runs them with no config, no
 * transform and no extra dependency.
 *
 * What is covered is the part that decides: does this tarball differ, and what do
 * we tell the person who has to act on it. `findDrift` itself talks to npm and to
 * the network, so it is exercised by actually running the gate, not from here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diffTrees, formatDrift } from './check-drift.mjs';

/** Materialise `{ 'a/b.txt': 'contents' }` as a real directory tree. */
const tree = files => {
    const root = mkdtempSync(join(tmpdir(), 'drift-test-'));
    for (const [path, contents] of Object.entries(files)) {
        const full = join(root, path);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, contents);
    }
    return root;
};

const cleanup = [];
const make = files => {
    const root = tree(files);
    cleanup.push(root);
    return root;
};

test.after(() => cleanup.forEach(d => rmSync(d, { recursive: true, force: true })));

describe('diffTrees', () => {
    test('reports nothing for two identical trees', () => {
        const files = { 'package.json': '{"a":1}', 'dist/index.js': 'export {}' };
        assert.deepEqual(diffTrees(make(files), make(files)), []);
    });

    test('catches a file whose bytes changed — the whole point of the gate', () => {
        const npm = make({ 'dist/index.js': 'export const a = 1;' });
        const local = make({ 'dist/index.js': 'export const a = 2;' });

        assert.deepEqual(diffTrees(npm, local), ['differs: dist/index.js']);
    });

    test('catches a file that only the published tarball has', () => {
        const npm = make({ 'dist/index.js': 'x', 'dist/gone.d.ts': 'y' });
        const local = make({ 'dist/index.js': 'x' });

        assert.deepEqual(diffTrees(npm, local), ['only on npm: dist/gone.d.ts']);
    });

    test('catches a file that only the local build has', () => {
        const npm = make({ 'dist/index.js': 'x' });
        const local = make({ 'dist/index.js': 'x', 'dist/new.d.ts': 'y' });

        assert.deepEqual(diffTrees(npm, local), ['only local: dist/new.d.ts']);
    });

    test('descends into nested directories rather than stopping at the top', () => {
        const npm = make({ 'dist/utils/deep/a.js': '1' });
        const local = make({ 'dist/utils/deep/a.js': '2' });

        assert.deepEqual(diffTrees(npm, local), ['differs: dist/utils/deep/a.js']);
    });

    test('does not treat a same-size different-content file as equal', () => {
        // A length comparison would pass this; the gate compares bytes.
        const npm = make({ 'dist/index.js': 'aaaa' });
        const local = make({ 'dist/index.js': 'aaab' });

        assert.deepEqual(diffTrees(npm, local), ['differs: dist/index.js']);
    });

    test('reports every difference, not just the first', () => {
        const npm = make({ 'a.js': '1', 'b.js': '1', 'c.js': '1' });
        const local = make({ 'a.js': '2', 'b.js': '2', 'c.js': '1' });

        assert.deepEqual(diffTrees(npm, local), ['differs: a.js', 'differs: b.js']);
    });

    test('returns a stable, sorted order so reports do not churn', () => {
        const npm = make({ 'z.js': '1', 'a.js': '1' });
        const local = make({ 'z.js': '2', 'a.js': '2' });

        assert.deepEqual(diffTrees(npm, local), ['differs: a.js', 'differs: z.js']);
    });
});

describe('formatDrift', () => {
    const drifted = (name, differences) => ({
        name,
        version: '1.0.0',
        status: 'drifted',
        differences,
    });

    test('says nothing when every package matches npm', () => {
        const message = formatDrift([
            { name: '@cnstra/core', version: '1.0.0', status: 'same', differences: [] },
            { name: '@cnstra/persist', version: '0.1.0', status: 'new', differences: [] },
        ]);

        assert.equal(message, '');
    });

    test('names the drifted package and what to do about it', () => {
        const message = formatDrift([drifted('@cnstra/core', ['differs: dist/index.js'])]);

        assert.match(message, /@cnstra\/core@1\.0\.0/);
        assert.match(message, /differs: dist\/index\.js/);
        assert.match(message, /Bump their versions/);
    });

    test('treats a package it could not compare as a failure, not a pass', () => {
        // Fail-closed: an unreachable registry must never read as "no drift".
        const message = formatDrift([
            {
                name: '@cnstra/core',
                version: '1.0.0',
                status: 'unknown',
                differences: ['pack failed'],
            },
        ]);

        assert.notEqual(message, '');
        assert.match(message, /could not be compared/);
    });

    test('truncates a long difference list instead of printing hundreds of lines', () => {
        const many = Array.from({ length: 20 }, (_, i) => `differs: file-${i}.js`);
        const message = formatDrift([drifted('@cnstra/core', many)]);

        assert.match(message, /… and 12 more/);
    });

    test('reports every drifted package, not only the first', () => {
        const message = formatDrift([
            drifted('@cnstra/core', ['differs: a.js']),
            drifted('@cnstra/persist', ['differs: b.js']),
        ]);

        assert.match(message, /@cnstra\/core/);
        assert.match(message, /@cnstra\/persist/);
    });
});
