import RedisMock from 'ioredis-mock';
import { CNSDevToolsServerRepositoryRedis } from '../src/index';
import type { CNSDTOApp } from '@cnstra/devtools-dto';
import type { CNSDTOTopologySnapshot } from '@cnstra/devtools-server';

const makeApp = (id: string, o: Partial<CNSDTOApp> = {}): CNSDTOApp => ({
    id,
    name: `App ${id}`,
    version: '1.0.0',
    connectedAt: 1000,
    lastSeenAt: 1000,
    ...o,
});

const makeTopology = (
    cnsId: string,
    appId: string
): CNSDTOTopologySnapshot => ({
    cnsId,
    appId,
    appName: 'Test App',
    version: '1.0.0',
    timestamp: 1000,
    neurons: [],
    collaterals: [],
    dendrites: [],
});

describe('CNSDevToolsServerRepositoryRedis', () => {
    let repo: CNSDevToolsServerRepositoryRedis;

    beforeEach(async () => {
        // ioredis-mock shares its store across instances in a process, so flush
        // for per-test isolation.
        const redis = new RedisMock();
        await redis.flushall();
        repo = new CNSDevToolsServerRepositoryRedis(redis as any);
    });

    it('upserts and lists apps', async () => {
        await repo.upsertApp(makeApp('a'));
        await repo.upsertApp(makeApp('b'));
        await repo.upsertApp(makeApp('a', { name: 'Renamed' }));

        const apps = await repo.listApps();
        expect(apps).toHaveLength(2);
        expect(apps.find(a => a.id === 'a')?.name).toBe('Renamed');
    });

    it('saves and reads topology by cnsId and all', async () => {
        await repo.saveTopology(makeTopology('c1', 'a'));
        await repo.saveTopology(makeTopology('c2', 'a'));

        expect(await repo.getTopology('c1')).toHaveLength(1);
        expect((await repo.getTopology('c1'))[0].cnsId).toBe('c1');
        expect(await repo.getTopology('missing')).toEqual([]);
        expect(await repo.getTopology()).toHaveLength(2);
    });

    it('maps cns ↔ app', async () => {
        await repo.addCnsToApp('a', 'c1');
        await repo.addCnsToApp('a', 'c2');
        await repo.addCnsToApp('b', 'c3');

        expect((await repo.getCnsByApp('a')).sort()).toEqual(['c1', 'c2']);
        expect(await repo.findAppByCns('c3')).toBe('b');
        expect(await repo.findAppByCns('missing')).toBeUndefined();
    });

    it('returns empty for unknown app / empty store', async () => {
        expect(await repo.getCnsByApp('nope')).toEqual([]);
        expect(await repo.getTopology()).toEqual([]);
    });
});
