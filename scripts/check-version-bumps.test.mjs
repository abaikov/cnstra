import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { findUnbumped, formatBlocked, isShipped, packageDirOf } from './check-version-bumps.mjs';

const manifests = ({ base, head }) => (side, dir) => (side === 'base' ? base : head)[dir];

describe('isShipped', () => {
    test('source and readme ship', () => {
        assert.equal(isShipped('src/CNS.ts'), true);
        assert.equal(isShipped('README.md'), true);
        assert.equal(isShipped('package.json'), true);
    });

    test('tests and jest config do not ship', () => {
        assert.equal(isShipped('tests/cnstra.test.ts'), false);
        assert.equal(isShipped('src/tests/worker.test.ts'), false);
        assert.equal(isShipped('src/__tests__/a.ts'), false);
        assert.equal(isShipped('src/thing.spec.tsx'), false);
        assert.equal(isShipped('jest.config.js'), false);
    });
});

describe('packageDirOf', () => {
    test('maps a path to its package directory', () => {
        assert.equal(packageDirOf('packages/core/src/CNS.ts'), 'core');
        assert.equal(packageDirOf('docs/core/api.md'), undefined);
    });
});

describe('findUnbumped', () => {
    const base = {
        core: { name: '@cnstra/core', version: '3.2.1' },
        persist: { name: '@cnstra/persist', version: '0.2.7' },
        examples: { name: 'examples', version: '1.0.0' },
    };

    test('flags a package whose source changed under the same version', () => {
        const unbumped = findUnbumped({
            changedFiles: ['packages/core/src/CNS.ts'],
            manifestAt: manifests({ base, head: base }),
        });
        assert.deepEqual(unbumped, [{ dir: 'core', name: '@cnstra/core', version: '3.2.1' }]);
    });

    test('passes a package whose version moved with its source', () => {
        const unbumped = findUnbumped({
            changedFiles: ['packages/core/src/CNS.ts', 'packages/core/package.json'],
            manifestAt: manifests({ base, head: { ...base, core: { ...base.core, version: '3.2.2' } } }),
        });
        assert.deepEqual(unbumped, []);
    });

    test('ignores a change that only touches tests', () => {
        const unbumped = findUnbumped({
            changedFiles: ['packages/core/tests/cnstra.test.ts', 'packages/persist/src/tests/a.test.ts'],
            manifestAt: manifests({ base, head: base }),
        });
        assert.deepEqual(unbumped, []);
    });

    test('ignores private packages and packages that did not exist at the base', () => {
        const unbumped = findUnbumped({
            changedFiles: ['packages/examples/src/a.ts', 'packages/fresh/src/index.ts'],
            manifestAt: manifests({
                base,
                head: { ...base, examples: { ...base.examples, private: true }, fresh: { name: '@cnstra/fresh', version: '0.1.0' } },
            }),
        });
        assert.deepEqual(unbumped, []);
    });

    test('ignores files outside packages', () => {
        const unbumped = findUnbumped({
            changedFiles: ['docs/core/api.md', 'scripts/check-drift.mjs'],
            manifestAt: manifests({ base, head: base }),
        });
        assert.deepEqual(unbumped, []);
    });
});

describe('formatBlocked', () => {
    test('names each package, its directory, and the way out', () => {
        const message = formatBlocked([{ dir: 'core', name: '@cnstra/core', version: '3.2.1' }]);
        assert.match(message, /@cnstra\/core@3\.2\.1 {2}\(packages\/core\)/);
        assert.match(message, /git push --no-verify/);
    });
});
