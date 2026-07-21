import { CNSDevToolsServerRepositoryInMemory } from '../src/index';
import type { CNSDTOApp, CNSDTOStimulation, CNSDTOHop } from '@cnstra/devtools-dto';
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

const makeStimulation = (id: string, appId: string, overrides: Partial<CNSDTOStimulation> = {}): CNSDTOStimulation => ({
    id,
    cnsId: `${appId}:cns`,
    appId,
    collateralId: `${appId}:cns:n:col`,
    payload: {},
    startedAt: Date.now(),
    completedAt: null,
    hopCount: 0,
    hasError: false,
    replayOf: null,
    ...overrides,
});

const makeHop = (id: string, stimulationId: string, index: number): CNSDTOHop => ({
    id,
    stimulationId,
    index,
    neuronId: 'app:cns:n',
    inputCollateralId: 'app:cns:n:col',
    outputCollateralId: null,
    inputPayload: {},
    outputPayload: null,
    startedAt: Date.now(),
    duration: null,
    error: null,
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

    describe('Stimulations', () => {
        test('saves and gets stimulations with filter', () => {
            repo.saveStimulation(makeStimulation('exec-1', 'app-1'));
            const { items, total } = repo.getStimulations('app-1', {});
            expect(total).toBe(1);
            expect(items[0].id).toBe('exec-1');
        });

        test('completes stimulation', () => {
            repo.saveStimulation(makeStimulation('exec-1', 'app-1'));
            repo.completeStimulation('exec-1', Date.now(), 3, false);
            const { items } = repo.getStimulations('app-1', {});
            expect(items[0].completedAt).not.toBeNull();
            expect(items[0].hopCount).toBe(3);
        });

        test('completeStimulation ignores unknown id', () => {
            expect(() => repo.completeStimulation('no-such', Date.now(), 0, false)).not.toThrow();
        });

        test('filters by fromTimestamp', () => {
            const now = Date.now();
            repo.saveStimulation(makeStimulation('old', 'app', { startedAt: now - 1000 }));
            repo.saveStimulation(makeStimulation('new', 'app', { startedAt: now + 1000 }));
            const { items } = repo.getStimulations('app', { fromTimestamp: now });
            expect(items.map(i => i.id)).toEqual(['new']);
        });

        test('filters by toTimestamp', () => {
            const now = Date.now();
            repo.saveStimulation(makeStimulation('old', 'app', { startedAt: now - 1000 }));
            repo.saveStimulation(makeStimulation('new', 'app', { startedAt: now + 1000 }));
            const { items } = repo.getStimulations('app', { toTimestamp: now });
            expect(items.map(i => i.id)).toEqual(['old']);
        });

        test('filters by hasError', () => {
            repo.saveStimulation(makeStimulation('ok', 'app', { hasError: false }));
            repo.saveStimulation(makeStimulation('err', 'app', { hasError: true }));
            const { items } = repo.getStimulations('app', { hasError: true });
            expect(items.map(i => i.id)).toEqual(['err']);
        });

        test('filters by collateralId', () => {
            repo.saveStimulation(makeStimulation('e1', 'app', { collateralId: 'app:cns:n:col-a' }));
            repo.saveStimulation(makeStimulation('e2', 'app', { collateralId: 'app:cns:n:col-b' }));
            const { items } = repo.getStimulations('app', { collateralId: 'app:cns:n:col-a' });
            expect(items.map(i => i.id)).toEqual(['e1']);
        });

        test('filters by neuronId prefix', () => {
            repo.saveStimulation(makeStimulation('e1', 'app', { collateralId: 'app:cns:neuronA:col' }));
            repo.saveStimulation(makeStimulation('e2', 'app', { collateralId: 'app:cns:neuronB:col' }));
            const { items } = repo.getStimulations('app', { neuronId: 'app:cns:neuronA' });
            expect(items.map(i => i.id)).toEqual(['e1']);
        });

        test('paginates stimulations', () => {
            const now = Date.now();
            for (let i = 0; i < 5; i++) {
                repo.saveStimulation(makeStimulation(`exec-${i}`, 'app', { startedAt: now + i }));
            }
            const { items, total } = repo.getStimulations('app', { limit: 2, offset: 1 });
            expect(total).toBe(5);
            expect(items).toHaveLength(2);
        });

        test('returns only stimulations for requested appId', () => {
            repo.saveStimulation(makeStimulation('e1', 'app-1'));
            repo.saveStimulation(makeStimulation('e2', 'app-2'));
            const { items } = repo.getStimulations('app-1', {});
            expect(items.every(e => e.appId === 'app-1')).toBe(true);
        });

        test('sorts stimulations by startedAt descending', () => {
            const now = Date.now();
            repo.saveStimulation(makeStimulation('early', 'app', { startedAt: now - 100 }));
            repo.saveStimulation(makeStimulation('late', 'app', { startedAt: now + 100 }));
            const { items } = repo.getStimulations('app', {});
            expect(items[0].id).toBe('late');
            expect(items[1].id).toBe('early');
        });

        test('uses default limit and offset when not provided', () => {
            for (let i = 0; i < 5; i++) {
                repo.saveStimulation(makeStimulation(`exec-${i}`, 'app'));
            }
            const { items } = repo.getStimulations('app', {});
            expect(items).toHaveLength(5);
        });
    });

    describe('Hops', () => {
        test('saves and gets hops sorted by index', () => {
            repo.saveHop(makeHop('h2', 'exec-1', 2));
            repo.saveHop(makeHop('h0', 'exec-1', 0));
            repo.saveHop(makeHop('h1', 'exec-1', 1));
            const hops = repo.getHops('exec-1');
            expect(hops.map(h => h.index)).toEqual([0, 1, 2]);
        });

        test('returns empty array for unknown stimulationId', () => {
            expect(repo.getHops('no-such')).toEqual([]);
        });

        test('keeps hops isolated per stimulationId', () => {
            repo.saveHop(makeHop('h1', 'exec-1', 0));
            repo.saveHop(makeHop('h2', 'exec-2', 0));
            expect(repo.getHops('exec-1')).toHaveLength(1);
            expect(repo.getHops('exec-2')).toHaveLength(1);
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
            repo.saveStimulation(makeStimulation('exec-1', 'app-1'));
            repo.saveHop(makeHop('h1', 'exec-1', 0));
            repo.addCnsToApp('app-1', 'app-1:cns');

            repo.clear();

            expect(repo.listApps()).toEqual([]);
            expect(repo.getTopology()).toEqual([]);
            expect(repo.getStimulations('app-1', {})).toEqual({ items: [], total: 0 });
            expect(repo.getHops('exec-1')).toEqual([]);
            expect(repo.getCnsByApp('app-1')).toEqual([]);
            expect(repo.findAppByCns('app-1:cns')).toBeUndefined();
        });

        test('clear works on empty repository', () => {
            expect(() => repo.clear()).not.toThrow();
        });
    });
});
