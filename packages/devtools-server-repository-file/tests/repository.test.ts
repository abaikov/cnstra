import { CNSDevToolsServerRepositoryFile } from '../src';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('CNSDevToolsServerRepositoryFile', () => {
    const tmpDir = path.join(process.cwd(), '.tmp-devtools-repo');

    beforeAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.mkdir(tmpDir, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('persists apps and messages to disk', async () => {
        const repo = new CNSDevToolsServerRepositoryFile({
            baseDir: tmpDir,
            maxMessages: 5,
        });

        await repo.upsertApp({ appId: 'shop', appName: 'Shop' } as any);
        let apps = await repo.listApps();
        expect(apps.length).toBe(1);
        expect((apps as any)[0].appId).toBe('shop');

        await repo.saveMessage({ type: 'init', devToolsInstanceId: 'shop' });
        await repo.saveMessage({
            type: 'stimulation',
            appId: 'shop',
            timestamp: Date.now(),
        });

        // Recreate repo to ensure it reads persisted state
        const repo2 = new CNSDevToolsServerRepositoryFile({
            baseDir: tmpDir,
            maxMessages: 5,
        });
        apps = await repo2.listApps();
        expect(apps.length).toBe(1);
        expect((apps as any)[0].appName).toBe('Shop');

        // Append more than maxMessages and verify trimming
        for (let i = 0; i < 10; i++) {
            await repo2.saveMessage({
                type: 'stimulation',
                appId: 'shop',
                timestamp: Date.now(),
                i,
            });
        }
        const content = await fs.readFile(
            path.join(tmpDir, 'messages.jsonl'),
            'utf8'
        );
        const lines = content.split('\n').filter(Boolean);
        expect(lines.length).toBeLessThanOrEqual(5);
    });
});
