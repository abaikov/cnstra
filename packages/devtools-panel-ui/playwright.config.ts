import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

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
    globalSetup: path.resolve(__dirname, 'e2e', 'playwright.global-setup.ts'),
    globalTeardown: path.resolve(
        __dirname,
        'e2e',
        'playwright.global-teardown.ts'
    ),
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
