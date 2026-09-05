import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Separate config for the BIG-DATASET filter-correctness suite: it boots the
// example-app with SEED_BIG=1 (hundreds of neurons + ~18k stimulations over ~90
// days). Kept apart from the default e2e (which needs the LIVE demo for
// clone/retry), since both bind :8080.
export default defineConfig({
    testDir: './e2e-bigdata',
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    timeout: 120000,
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
    },
    globalSetup: path.resolve(__dirname, 'e2e', 'playwright.global-setup-bigdata.ts'),
    globalTeardown: path.resolve(__dirname, 'e2e', 'playwright.global-teardown-bigdata.ts'),
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
