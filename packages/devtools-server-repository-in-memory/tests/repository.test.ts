import { CNSDevToolsServerRepositoryInMemory } from '../src/index';
import type { CNSDTOApp } from '@cnstra/devtools-dto';
import type { CNSDTOTopologySnapshot } from '@cnstra/devtools-server';

const makeApp = (id: string, overrides: Partial<CNSDTOApp> = {}): CNSDTOApp => ({
    id,
    name: `App ${id}`,
    version: '1.0.0',
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides,
});

const makeTopology = (cnsId: string, appId: string): CNSDTOTopologySnapshot => ({
    cnsId,
    appId,
    appName: 'Test App',
    version: '1.0.0',
    timestamp: Date.now(),
    neurons: [],
    collaterals: [],
    dendrites: [],
});

describe('CNSDevToolsServerRepositoryInMemory', () => {
    let repo: CNSDevToolsServerRepositoryInMemory;

    beforeEach(() => {
        repo = new CNSDevToolsServerRepositoryInMemory();
    });

    describe('Apps', () => {
        test('upserts and lists apps', () => {
            repo.upsertApp(makeApp('app-1'));
            expect(repo.listApps()).toHaveLength(1);
            expect(repo.listApps()[0].id).toBe('app-1');
        });

        test('overwrites app on re-upsert', () => {
            repo.upsertApp(makeApp('app-1', { name: 'Old' }));
            repo.upsertApp(makeApp('app-1', { name: 'New' }));
            const apps = repo.listApps();
            expect(apps).toHaveLength(1);
            expect(apps[0].name).toBe('New');
        });

        test('stores multiple apps independently', () => {
            repo.upsertApp(makeApp('app-1'));
            repo.upsertApp(makeApp('app-2'));
            const ids = repo.listApps().map(a => a.id).sort();
            expect(ids).toEqual(['app-1', 'app-2']);
        });

        test('listApps returns empty array initially', () => {
            expect(repo.listApps()).toEqual([]);
        });
    });

    describe('Topology', () => {
        test('saves and gets topology', () => {
            repo.saveTopology(makeTopology('app:cns', 'app'));
            const result = repo.getTopology();
            expect(result).toHaveLength(1);
            expect(result[0].cnsId).toBe('app:cns');
        });

        test('gets topology by cnsId', () => {
            repo.saveTopology(makeTopology('app:cns1', 'app'));
            repo.saveTopology(makeTopology('app:cns2', 'app'));
            expect(repo.getTopology('app:cns1')).toHaveLength(1);
            expect(repo.getTopology('app:cns1')[0].cnsId).toBe('app:cns1');
        });

        test('returns empty array for unknown cnsId', () => {
            expect(repo.getTopology('unknown')).toEqual([]);
        });

        test('overwrites topology for same cnsId', () => {
            repo.saveTopology(makeTopology('app:cns', 'app'));
            repo.saveTopology({ ...makeTopology('app:cns', 'app'), appName: 'Updated' });
            const result = repo.getTopology('app:cns');
            expect(result).toHaveLength(1);
            expect(result[0].appName).toBe('Updated');
        });
    });

    describe('CNS mapping', () => {
        test('maps cns to app bidirectionally', () => {
            repo.addCnsToApp('app-1', 'app-1:cns');
            expect(repo.findAppByCns('app-1:cns')).toBe('app-1');
            expect(repo.getCnsByApp('app-1')).toContain('app-1:cns');
        });

        test('supports multiple cns per app', () => {
            repo.addCnsToApp('app-1', 'app-1:cns-a');
            repo.addCnsToApp('app-1', 'app-1:cns-b');
            expect(repo.getCnsByApp('app-1')).toHaveLength(2);
        });

        test('findAppByCns returns undefined for unknown cnsId', () => {
            expect(repo.findAppByCns('unknown')).toBeUndefined();
        });

        test('getCnsByApp returns empty array for unknown appId', () => {
            expect(repo.getCnsByApp('unknown')).toEqual([]);
        });

        test('addCnsToApp is idempotent', () => {
            repo.addCnsToApp('app-1', 'app-1:cns');
            repo.addCnsToApp('app-1', 'app-1:cns');
            expect(repo.getCnsByApp('app-1')).toHaveLength(1);
        });
    });

    describe('Clear', () => {
        test('clears all data', () => {
            repo.upsertApp(makeApp('app-1'));
            repo.saveTopology(makeTopology('app-1:cns', 'app-1'));
            repo.addCnsToApp('app-1', 'app-1:cns');

            repo.clear();

            expect(repo.listApps()).toEqual([]);
            expect(repo.getTopology()).toEqual([]);
            expect(repo.getCnsByApp('app-1')).toEqual([]);
            expect(repo.findAppByCns('app-1:cns')).toBeUndefined();
        });

        test('clear works on empty repository', () => {
            expect(() => repo.clear()).not.toThrow();
        });
    });
});
