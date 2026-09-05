#!/usr/bin/env node

/**
 * Content drift check.
 *
 * A package can carry the SAME version number as the one on npm and still ship
 * different code — that is exactly what happens when a change lands without a
 * version bump. Version numbers alone therefore cannot answer "what is not
 * published yet", so this compares the actual publishable artifact: the local
 * `npm pack` tarball against the published tarball of the same version.
 *
 * Exit code 1 when any package has drifted (i.e. someone forgot to bump).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Every workspace directory the root manifest declares. Reading the `workspaces`
 * globs (rather than hardcoding `packages/*`) is what keeps a workspace added
 * elsewhere — `docs`, or whatever comes next — inside the gate automatically.
 */
const workspaceDirs = () => {
    const { workspaces = [] } = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const dirs = [];

    for (const pattern of workspaces) {
        if (pattern.endsWith('/*')) {
            const parent = join(REPO_ROOT, pattern.slice(0, -2));
            try {
                for (const entry of readdirSync(parent, { withFileTypes: true })) {
                    if (entry.isDirectory()) dirs.push(join(parent, entry.name));
                }
            } catch {
                // A declared workspace root that does not exist yet: nothing to check.
            }
        } else {
            dirs.push(join(REPO_ROOT, pattern));
        }
    }

    return dirs;
};

const readPackages = () =>
    workspaceDirs()
        .map(dir => {
            try {
                return {
                    dir,
                    manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
                };
            } catch {
                return undefined;
            }
        })
        .filter(pkg => pkg && !pkg.manifest.private);

const listFiles = (root, prefix = '') => {
    const files = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...listFiles(join(root, entry.name), relative));
        else files.push(relative);
    }
    return files;
};

/** Every path where the two trees disagree — missing on either side, or different bytes. */
const diffTrees = (left, right) => {
    const leftFiles = new Set(listFiles(left));
    const rightFiles = new Set(listFiles(right));
    const differences = [];

    for (const file of leftFiles) {
        if (!rightFiles.has(file)) {
            differences.push(`only on npm: ${file}`);
            continue;
        }
        if (!readFileSync(join(left, file)).equals(readFileSync(join(right, file)))) {
            differences.push(`differs: ${file}`);
        }
    }
    for (const file of rightFiles) {
        if (!leftFiles.has(file)) differences.push(`only local: ${file}`);
    }

    return differences.sort();
};

const extractPack = (packArgs, into) => {
    mkdirSync(into, { recursive: true });
    const packed = spawnSync(npm, [...packArgs, `--pack-destination=${into}`], {
        encoding: 'utf8',
        shell: false,
    });
    if (packed.status !== 0) return undefined;

    const tarball = readdirSync(into).find(file => file.endsWith('.tgz'));
    if (!tarball) return undefined;

    const untarred = spawnSync('tar', ['-xzf', join(into, tarball), '-C', into], {
        encoding: 'utf8',
        shell: false,
    });
    if (untarred.status !== 0) return undefined;

    const extracted = join(into, 'package');
    try {
        return statSync(extracted).isDirectory() ? extracted : undefined;
    } catch {
        return undefined;
    }
};

/**
 * @param {{ build?: boolean, only?: string[], log?: (line: string) => void }} options
 * @returns {{ name: string, version: string, status: 'same'|'drifted'|'unpublished'|'unknown', differences: string[] }[]}
 */
export const findDrift = ({ build = true, only, log = () => {} } = {}) => {
    const packages = readPackages().filter(pkg => !only || only.includes(pkg.manifest.name));
    const workdir = mkdtempSync(join(tmpdir(), 'cnstra-drift-'));
    const results = [];

    try {
        for (const { manifest } of packages) {
            const { name, version } = manifest;

            const onNpm = spawnSync(npm, ['view', `${name}@${version}`, 'version'], {
                encoding: 'utf8',
                shell: false,
            });
            if (onNpm.stdout.trim() !== version) {
                log(`  unpublished  ${name}@${version}`);
                results.push({ name, version, status: 'unpublished', differences: [] });
                continue;
            }

            if (build) {
                const built = spawnSync(npm, ['run', 'build', `--workspace=${name}`, '--if-present'], {
                    encoding: 'utf8',
                    shell: false,
                });
                if (built.status !== 0) {
                    log(`  BUILD FAILED ${name}@${version}`);
                    results.push({ name, version, status: 'unknown', differences: ['build failed'] });
                    continue;
                }
            }

            const slot = join(workdir, name.replace(/[^a-zA-Z0-9]/g, '_'));
            const local = extractPack(['pack', `--workspace=${name}`], join(slot, 'local'));
            const published = extractPack(['pack', `${name}@${version}`], join(slot, 'npm'));

            if (!local || !published) {
                log(`  UNKNOWN      ${name}@${version} (could not pack local and/or published tarball)`);
                results.push({ name, version, status: 'unknown', differences: ['pack failed'] });
                continue;
            }

            const differences = diffTrees(published, local);
            if (differences.length === 0) {
                log(`  same         ${name}@${version}`);
                results.push({ name, version, status: 'same', differences });
            } else {
                log(`  DRIFTED      ${name}@${version} (${differences.length} file(s))`);
                results.push({ name, version, status: 'drifted', differences });
            }
        }
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }

    return results;
};

/** Human-readable abort message for the packages that shipped without a bump. */
export const formatDrift = results => {
    const broken = results.filter(r => r.status === 'drifted' || r.status === 'unknown');
    if (broken.length === 0) return '';

    const lines = ['', '❌ These packages differ from what is published under the SAME version:'];
    for (const { name, version, status, differences } of broken) {
        lines.push(`  ${name}@${version}${status === 'unknown' ? '  (could not be compared)' : ''}`);
        for (const difference of differences.slice(0, 8)) lines.push(`      ${difference}`);
        if (differences.length > 8) lines.push(`      … and ${differences.length - 8} more`);
    }
    lines.push('', 'Bump their versions (and the ranges that depend on them), then publish.', '');
    return lines.join('\n');
};

/**
 * The env var `scripts/publish-workspaces.mjs` sets once its own gate has passed,
 * so the per-package `prepublishOnly` hooks below it do not redo the same work
 * twenty times over.
 */
export const ALREADY_CHECKED = 'CNSTRA_DRIFT_CHECKED';

const isCli = process.argv[1] && process.argv[1].endsWith('check-drift.mjs');
if (isCli) {
    const build = !process.argv.includes('--no-build');

    // --gate: the `prepublishOnly` entry point. npm runs it for EVERY publish,
    // including a bare `npm publish` typed by hand, which is the one path the
    // repo's own publish script cannot guard.
    if (process.argv.includes('--gate') && process.env[ALREADY_CHECKED] === '1') {
        process.exit(0);
    }

    console.log('Comparing every public package against its published tarball…\n');

    const results = findDrift({ build, log: line => console.log(line) });
    const message = formatDrift(results);

    if (message) {
        console.error(message);
        process.exit(1);
    }

    const unpublished = results.filter(r => r.status === 'unpublished');
    console.log(
        `\n✓ No drift. ${results.length - unpublished.length} package(s) match npm; ` +
            `${unpublished.length} awaiting first publish at their current version.`
    );
}
