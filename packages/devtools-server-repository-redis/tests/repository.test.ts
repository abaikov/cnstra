import RedisMock from 'ioredis-mock';
import { CNSDevToolsServerRepositoryRedis } from '../src/index';
import type { TCNSTopologySnapshotDTO } from '@cnstra/devtools-server';

const makeTopology = (
    cnsId: string,
    appId: string
): TCNSTopologySnapshotDTO => ({
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

    it('saves and reads topology by cnsId and all', async () => {
        await repo.saveTopology(makeTopology('c1', 'a'));
        await repo.saveTopology(makeTopology('c2', 'a'));

        expect(await repo.getTopology('c1')).toHaveLength(1);
        expect((await repo.getTopology('c1'))[0].cnsId).toBe('c1');
        expect(await repo.getTopology('missing')).toEqual([]);
        expect(await repo.getTopology()).toHaveLength(2);
    });

    it('finds the app of a cns from its topology', async () => {
        await repo.saveTopology(makeTopology('c3', 'b'));

        expect(await repo.findAppByCns('c3')).toBe('b');
        expect(await repo.findAppByCns('missing')).toBeUndefined();
    });

    it('returns empty for an empty store', async () => {
        expect(await repo.getTopology()).toEqual([]);
    });
});
