import type { FullConfig } from '@playwright/test';
import { child } from './playwright.global-setup';

export default async function globalTeardown(_config: FullConfig) {
    try {
        if (child && typeof child.kill === 'function') {
            child.kill('SIGTERM');
        }
    } catch {}
}
