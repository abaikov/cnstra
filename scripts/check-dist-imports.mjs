#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const JEST_ONLY = new Set(['@cnstra/jobs/testing']);

const conditionsOf = target => {
    if (typeof target === 'string') return [];
    const found = new Set();
    for (const [condition, nested] of Object.entries(target ?? {})) {
        if (condition === 'import' || condition === 'require') found.add(condition);
        if (nested && typeof nested === 'object') conditionsOf(nested).forEach(c => found.add(c));
    }
    return [...found];
};

export const entriesOf = manifest => {
    if (manifest.exports === undefined && manifest.main === undefined) return [];
    const moduleKind = manifest.type === 'module' ? 'import' : 'require';
    const exportsMap =
        typeof manifest.exports === 'string' || manifest.exports === undefined
            ? { '.': manifest.exports ?? manifest.main }
            : Object.keys(manifest.exports).some(key => key.startsWith('.'))
              ? manifest.exports
              : { '.': manifest.exports };
    const entries = [];
    for (const [subpath, target] of Object.entries(exportsMap)) {
        if (subpath.includes('*') || subpath === './package.json') continue;
        const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
        if (JEST_ONLY.has(specifier)) continue;
        const conditions = conditionsOf(target);
        for (const mode of conditions.length ? conditions : [moduleKind]) entries.push({ specifier, mode });
    }
    return entries;
};

export const leaksOf = ({ manifest, files, privateNames, exists }) => {
    const problems = [];
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(manifest[field] ?? {})) {
            if (privateNames.has(name)) problems.push(`${manifest.name} lists the private package ${name} in ${field}`);
        }
    }
    for (const { path, text } of files) {
        for (const name of privateNames) {
            if (text.includes(`'${name}'`) || text.includes(`"${name}"`)) problems.push(`${path} imports the private package ${name}`);
        }
        if (!/\.d\.m?ts$/.test(path)) continue;
        for (const [, specifier] of text.matchAll(/^(?:import|export)\b[^\n]*?from ['"](\.{1,2}\/[^'"]+)['"]/gm)) {
            const base = join(dirname(path), specifier.replace(/\.m?js$/, ''));
            const found = ['.d.ts', '.d.mts', '/index.d.ts', '/index.d.mts'].some(suffix => exists(base + suffix));
            if (!found) problems.push(`${path} imports ${specifier}, which is not in dist`);
        }
    }
    return problems;
};

const workspaceManifests = () => {
    const parent = join(REPO_ROOT, 'packages');
    return readdirSync(parent, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            try {
                return { directory: join(parent, entry.name), manifest: JSON.parse(readFileSync(join(parent, entry.name, 'package.json'), 'utf8')) };
            } catch {
                return undefined;
            }
        })
        .filter(Boolean);
};

const distFilesOf = directory => {
    const dist = join(directory, 'dist');
    if (!existsSync(dist)) return [];
    return readdirSync(dist, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && !entry.name.endsWith('.map'))
        .map(entry => join(entry.parentPath ?? entry.path, entry.name))
        .map(path => ({ path, text: readFileSync(path, 'utf8') }));
};

const publicManifests = () => {
    const parent = join(REPO_ROOT, 'packages');
    return readdirSync(parent, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            try {
                return JSON.parse(readFileSync(join(parent, entry.name, 'package.json'), 'utf8'));
            } catch {
                return undefined;
            }
        })
        .filter(manifest => manifest && !manifest.private);
};

const load = ({ specifier, mode }) => {
    const source =
        mode === 'import'
            ? `await import(${JSON.stringify(specifier)})`
            : `require(${JSON.stringify(specifier)})`;
    const args = mode === 'import' ? ['--input-type=module', '-e', source] : ['--no-experimental-require-module', '-e', source];
    const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    return result.status === 0 ? undefined : (result.stderr || result.stdout).trim().split('\n').slice(0, 6).join('\n');
};

const isCli = process.argv[1] && process.argv[1].endsWith('check-dist-imports.mjs');
if (isCli) {
    const workspaces = workspaceManifests();
    const privateNames = new Set(workspaces.filter(({ manifest }) => manifest.private).map(({ manifest }) => manifest.name));
    const leaks = workspaces
        .filter(({ manifest }) => !manifest.private)
        .flatMap(({ directory, manifest }) => leaksOf({ manifest, files: distFilesOf(directory), privateNames, exists: existsSync }));
    for (const leak of leaks) console.error(`✗ ${leak}`);
    const failures = [];
    let checked = 0;
    for (const manifest of publicManifests()) {
        for (const entry of entriesOf(manifest)) {
            checked++;
            const error = load(entry);
            if (error) failures.push({ ...entry, error });
        }
    }
    for (const { specifier, mode, error } of failures) console.error(`✗ ${mode} ${specifier}\n${error}\n`);
    if (leaks.length) {
        console.error(`${leaks.length} leak(s) of private packages or missing declaration files.`);
        process.exit(1);
    }
    if (failures.length) {
        console.error(`${failures.length} of ${checked} dist entry point(s) failed to load.`);
        process.exit(1);
    }
    console.log(`✓ ${checked} dist entry point(s) load in Node.`);
}
