#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const workspaces = [];
let otp;
let dryRun = false;
let bumped = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
        dryRun = true;
        continue;
    }

    if (arg === '--bumped' || arg === '--only-bumped') {
        bumped = true;
        continue;
    }

    if (arg === '--otp') {
        otp = args[++i];
        continue;
    }

    if (arg.startsWith('--otp=')) {
        otp = arg.slice('--otp='.length);
        continue;
    }

    if (arg === '--workspace' || arg === '-w') {
        workspaces.push(args[++i]);
        continue;
    }

    if (arg.startsWith('--workspace=')) {
        workspaces.push(arg.slice('--workspace='.length));
        continue;
    }

    if (arg.startsWith('-w=')) {
        workspaces.push(arg.slice('-w='.length));
        continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < 22) {
    throw new Error(
        `Node 22+ is required for publishing. Current Node is ${process.versions.node}. Run: nvm use 22`
    );
}

const run = (command, commandArgs) => {
    const result = spawnSync(command, commandArgs, {
        stdio: 'inherit',
        shell: false,
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
};

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmRun = script => run(npm, ['run', script, '--if-present']);

run(npm, ['whoami']);

// --bumped: auto-select every public package whose current version is not yet on
// npm (i.e. it was bumped, or is brand new) and publish only those.
if (bumped) {
    if (workspaces.length > 0) {
        throw new Error('--bumped cannot be combined with --workspace');
    }

    const packagesDir = new URL('../packages', import.meta.url).pathname;
    const pkgDirs = readdirSync(packagesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => join(packagesDir, d.name, 'package.json'));

    for (const pkgPath of pkgDirs) {
        let pkg;
        try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
        if (pkg.private) continue;

        // Empty / mismatched stdout => this exact version is not published => publish it.
        const result = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], { encoding: 'utf8' });
        if (result.stdout.trim() !== pkg.version) {
            workspaces.push(pkg.name);
        }
    }

    if (workspaces.length === 0) {
        console.log('✓ Nothing to publish — every public package is already on npm at its current version.');
        process.exit(0);
    }

    console.log(`Publishing bumped packages:\n${workspaces.map(w => `  ${w}`).join('\n')}\n`);
}

// Pre-publish check: verify no package tries to overwrite an already-published version
{
    const packagesDir = new URL('../packages', import.meta.url).pathname;
    const pkgDirs = readdirSync(packagesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => join(packagesDir, d.name, 'package.json'));

    const toCheck = [];
    for (const pkgPath of pkgDirs) {
        let pkg;
        try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
        if (pkg.private) continue;
        if (workspaces.length > 0 && !workspaces.includes(pkg.name)) continue;
        toCheck.push({ name: pkg.name, version: pkg.version });
    }

    const conflicts = [];
    for (const { name, version } of toCheck) {
        const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
        if (result.stdout.trim() === version) {
            conflicts.push(`  ${name}@${version}`);
        }
    }

    if (conflicts.length > 0) {
        console.error('\n❌ Cannot publish — these versions already exist on npm:');
        conflicts.forEach(c => console.error(c));
        console.error('\nBump their versions before publishing.\n');
        process.exit(1);
    }

    console.log(`✓ Version check passed (${toCheck.length} packages)\n`);
}

if (workspaces.length === 0) {
    npmRun('lint');
    npmRun('test');
    npmRun('test:types');
    npmRun('build');
} else {
    npmRun('lint');

    for (const workspace of workspaces) {
        run(npm, ['run', 'test', `--workspace=${workspace}`, '--if-present']);
        run(npm, [
            'run',
            'test:types',
            `--workspace=${workspace}`,
            '--if-present',
        ]);
        run(npm, ['run', 'build', `--workspace=${workspace}`, '--if-present']);
    }
}

const publishArgs = ['publish', '--access', 'public'];

if (workspaces.length === 0) {
    publishArgs.push('--workspaces');
} else {
    for (const workspace of workspaces) {
        publishArgs.push(`--workspace=${workspace}`);
    }
}

if (dryRun) {
    publishArgs.push('--dry-run');
}

if (otp) {
    publishArgs.push(`--otp=${otp}`);
}

run(npm, publishArgs);
