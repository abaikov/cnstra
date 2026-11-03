import { Pool } from 'pg';
import { CNSDevToolsServerRepositoryPostgres } from '../src/index';
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

const URL = process.env.DATABASE_URL;
const prefix = 'cnstest_devtools_';

(URL ? describe : describe.skip)('CNSDevToolsServerRepositoryPostgres', () => {
    const pool = new Pool({ connectionString: URL });
    let repo: CNSDevToolsServerRepositoryPostgres;

    const drop = () => pool.query(`DROP TABLE IF EXISTS ${prefix}topology, ${prefix}devtools_migration`);

    beforeEach(async () => {
        await drop();
        repo = new CNSDevToolsServerRepositoryPostgres(pool, { tablePrefix: prefix });
        await repo.init();
    });

    afterAll(async () => {
        await drop();
        await pool.end();
    });

    it('saves and reads topology by cnsId and all', async () => {
        await repo.saveTopology(makeTopology('c1', 'a'));
        await repo.saveTopology(makeTopology('c2', 'a'));

        const one = await repo.getTopology('c1');
        expect(one).toHaveLength(1);
        expect(one[0].cnsId).toBe('c1');
        expect(one[0].neurons).toEqual([]);
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

    it('installs once and passes verify', async () => {
        await repo.init();

        await expect(repo.verify()).resolves.toBeUndefined();
    });
});
