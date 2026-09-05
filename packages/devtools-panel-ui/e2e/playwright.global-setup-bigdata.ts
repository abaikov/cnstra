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
            const p = spawn('npm', args, { cwd, env: process.env, stdio: 'inherit' });
            p.on('exit', code => (code === 0 ? resolve() : reject(new Error(name + ' failed'))));
            p.on('error', reject);
        });
    await run(['run', 'build', '--silent'], panelDir, 'panel build');
    await run(['run', 'prestart', '--silent'], exampleDir, 'example prestart');
}

async function startSeedBigServer() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const exampleDir = path.resolve(repoRoot, 'example-app');
    // The whole point: the panel serves + connects on :8080; SEED_BIG=1 loads the
    // big synthetic dataset (hundreds of neurons + ~18k stimulations over ~90 days).
    child = spawn('node', ['dist/index.js'], {
        cwd: exampleDir,
        env: { ...process.env, PORT: '8080', SEED_BIG: '1' },
        stdio: 'pipe',
    });
    child.stdout?.on('data', (d: Buffer) => console.log('SeedBig app:', d.toString()));
    child.stderr?.on('data', (d: Buffer) => console.error('SeedBig app error:', d.toString()));

    const startedAt = Date.now();
    while (Date.now() - startedAt < 40000) {
        try {
            const res = await fetch('http://localhost:8080');
            if (res.ok) {
                console.log('✅ SEED_BIG example server is ready');
                return;
            }
        } catch {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('SEED_BIG example server did not start in time');
}

export default async function globalSetup(_config: FullConfig) {
    try {
        await buildWorkspace();
    } catch {}
    await startSeedBigServer();
}

export { child };
