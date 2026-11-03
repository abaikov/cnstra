#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOT_SHIPPED = [
    /(^|\/)tests?\//,
    /(^|\/)__tests__\//,
    /\.(test|spec)\.[cm]?[jt]sx?$/,
    /(^|\/)jest\.config\.[cm]?[jt]s$/,
];

const ZERO_SHA = /^0+$/;

export const packageDirOf = path => path.match(/^packages\/([^/]+)\//)?.[1];

export const isShipped = pathInPackage => !NOT_SHIPPED.some(pattern => pattern.test(pathInPackage));

export function findUnbumped({ changedFiles, manifestAt }) {
    const touched = new Set();
    for (const path of changedFiles) {
        const dir = packageDirOf(path);
        if (dir && isShipped(path.slice(`packages/${dir}/`.length))) touched.add(dir);
    }

    const unbumped = [];
    for (const dir of [...touched].sort()) {
        const before = manifestAt('base', dir);
        const after = manifestAt('head', dir);
        if (!before || !after || after.private) continue;
        if (before.version === after.version) {
            unbumped.push({ dir, name: after.name, version: after.version });
        }
    }
    return unbumped;
}

const git = args => spawnSync('git', args, { encoding: 'utf8' });

const manifestAtCommit = (commit, dir) => {
    const result = git(['show', `${commit}:packages/${dir}/package.json`]);
    if (result.status !== 0) return undefined;
    try {
        return JSON.parse(result.stdout);
    } catch {
        return undefined;
    }
};

const isPublished = ({ name, version }) => {
    const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
    if (result.status !== 0 && !/E404/.test(result.stderr)) return undefined;
    return result.stdout.trim() === version;
};

export function checkRange(base, head) {
    const diff = git(['diff', '--name-only', `${base}...${head}`]);
    if (diff.status !== 0) {
        return { blocked: [], unknown: [], error: diff.stderr.trim() };
    }
    const changedFiles = diff.stdout.split('\n').filter(Boolean);
    const commits = { base, head };
    const unbumped = findUnbumped({
        changedFiles,
        manifestAt: (side, dir) => manifestAtCommit(commits[side], dir),
    });

    const blocked = [];
    const unknown = [];
    for (const pkg of unbumped) {
        const published = isPublished(pkg);
        if (published === undefined) unknown.push(pkg);
        else if (published) blocked.push(pkg);
    }
    return { blocked, unknown };
}

export function formatBlocked(blocked) {
    return (
        '\n❌ Push refused: these packages changed what they ship, but their version is already on npm.\n\n' +
        blocked.map(({ dir, name, version }) => `  ${name}@${version}  (packages/${dir})`).join('\n') +
        '\n\nBump them (and every @cnstra/* range that points at them), commit, and push again.\n' +
        'To push anyway: git push --no-verify\n'
    );
}

const readPushedRefs = () =>
    readFileSync(0, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [localRef, localSha, remoteRef, remoteSha] = line.split(' ');
            return { localRef, localSha, remoteRef, remoteSha };
        });

function prePush() {
    let failed = false;
    for (const { localSha, remoteRef, remoteSha } of readPushedRefs()) {
        if (remoteRef !== 'refs/heads/master' || ZERO_SHA.test(localSha)) continue;
        const base = ZERO_SHA.test(remoteSha)
            ? git(['merge-base', localSha, 'origin/master']).stdout.trim()
            : remoteSha;
        if (!base) continue;

        const { blocked, unknown, error } = checkRange(base, localSha);
        if (error) {
            console.warn(`⚠ version-bump check skipped: ${error}`);
            continue;
        }
        if (unknown.length > 0) {
            console.warn(
                '⚠ npm did not answer for: ' +
                    unknown.map(({ name, version }) => `${name}@${version}`).join(', ') +
                    ' — not checked. CI drift check will catch it.'
            );
        }
        if (blocked.length > 0) {
            console.error(formatBlocked(blocked));
            failed = true;
        }
    }
    process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [base, head] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    if (process.argv.includes('--pre-push')) {
        prePush();
    } else {
        const { blocked, unknown, error } = checkRange(base ?? 'origin/master', head ?? 'HEAD');
        if (error) {
            console.error(error);
            process.exit(2);
        }
        for (const { name, version } of unknown) console.warn(`⚠ npm did not answer for ${name}@${version}`);
        if (blocked.length > 0) {
            console.error(formatBlocked(blocked));
            process.exit(1);
        }
        console.log('✓ Every package that changed what it ships has a version npm does not have yet.');
    }
}
