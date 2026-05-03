#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const workspaces = [];
let otp;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
        dryRun = true;
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
const npmRun = script => run(npm, ['run', script]);

run(npm, ['whoami']);

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
