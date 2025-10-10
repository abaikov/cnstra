import { defineConfig, devices } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';

// Helper to run example-app server before tests using its build output
function startExampleApp(): {
    command: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
} {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const exampleAppDir = path.resolve(repoRoot, 'example-app');
    return {
        command:
            'npm run prestart --silent --workspaces=false && npm run start --silent',
        cwd: exampleAppDir,
        env: { ...process.env, PORT: '8080' },
    } as any;
}

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
    },
    webServer: {
        ...startExampleApp(),
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
