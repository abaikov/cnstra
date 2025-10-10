import { FullConfig } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';

let child: any;

async function buildWorkspace() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const panelDir = path.resolve(repoRoot, 'devtools-panel-ui');
    const exampleDir = path.resolve(repoRoot, 'example-app');
    const run = (args: string[], cwd: string, name: string) =>
        new Promise<void>((resolve, reject) => {
            const p = spawn('npm', args, {
                cwd,
                env: process.env,
                stdio: 'inherit',
            });
            p.on('exit', code =>
                code === 0 ? resolve() : reject(new Error(name + ' failed'))
            );
            p.on('error', reject);
        });
    // Build panel UI (webpack)
    await run(['run', 'build', '--silent'], panelDir, 'panel build');
    // Compile example-app TS only (prestart also ensures UI built)
    await run(['run', 'prestart', '--silent'], exampleDir, 'example prestart');
}

async function startExampleServer() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const exampleDir = path.resolve(repoRoot, 'example-app');
    child = spawn('node', ['dist/index.js'], {
        cwd: exampleDir,
        env: { ...process.env, PORT: '8080' },
        stdio: 'inherit',
    });
    // Wait for server to be ready
    const startedAt = Date.now();
    const timeoutMs = 30000;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const res = await fetch('http://localhost:8080');
            if (res.ok) return;
        } catch {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('DevTools example server did not start in time');
}

export default async function globalSetup(_config: FullConfig) {
    // Assume prebuilt artifacts exist (dist folders) and just start the example server
    await startExampleServer();
}

export { child };
