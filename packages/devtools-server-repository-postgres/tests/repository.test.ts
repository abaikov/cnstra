import { newDb, DataType } from 'pg-mem';
import { CNSDevToolsServerRepositoryPostgres } from '../src/index';
import type {
    CNSDTOApp,
    CNSDTOStimulation,
    CNSDTOHop,
} from '@cnstra/devtools-dto';
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

const makeStim = (
    id: string,
    appId: string,
    o: Partial<CNSDTOStimulation> = {}
): CNSDTOStimulation => ({
    id,
    cnsId: `${appId}:cns`,
    appId,
    collateralId: `${appId}:cns:n:col`,
    payload: { x: 1 },
    startedAt: 1000,
    completedAt: null,
    hopCount: 0,
    hasError: false,
    replayOf: null,
    ...o,
});

const makeHop = (
    id: string,
    stimulationId: string,
    index: number
): CNSDTOHop => ({
    id,
    stimulationId,
    index,
    neuronId: 'app:cns:n',
    inputCollateralId: 'app:cns:n:in',
    outputCollateralId: null,
    inputPayload: null,
    outputPayload: null,
    startedAt: 1000 + index,
    duration: null,
    error: null,
});

function makePool() {
    const db = newDb();
    // pg-mem doesn't ship starts_with(); provide it for the neuronId prefix filter.
    db.public.registerFunction({
        name: 'starts_with',
        args: [DataType.text, DataType.text],
        returns: DataType.bool,
        implementation: (s: string, p: string) =>
            (s ?? '').startsWith(p ?? ''),
    });
    const { Pool } = db.adapters.createPg();
    return new Pool();
}

describe('CNSDevToolsServerRepositoryPostgres', () => {
    let repo: CNSDevToolsServerRepositoryPostgres;

    beforeEach(async () => {
        repo = new CNSDevToolsServerRepositoryPostgres(makePool());
        await repo.init();
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

        const one = await repo.getTopology('c1');
        expect(one).toHaveLength(1);
        expect(one[0].cnsId).toBe('c1');
        expect(one[0].neurons).toEqual([]);
        expect(await repo.getTopology('missing')).toEqual([]);
        expect(await repo.getTopology()).toHaveLength(2);
    });

    it('saves stimulations and returns them newest-first', async () => {
        await repo.saveStimulation(makeStim('s1', 'a', { startedAt: 100 }));
        await repo.saveStimulation(makeStim('s2', 'a', { startedAt: 300 }));
        await repo.saveStimulation(makeStim('s3', 'a', { startedAt: 200 }));
        await repo.saveStimulation(makeStim('other', 'b', { startedAt: 999 }));

        const { items, total } = await repo.getStimulations('a', {});
        expect(total).toBe(3);
        expect(items.map(s => s.id)).toEqual(['s2', 's3', 's1']);
    });

    it('filters by time range, hasError, collateralId and neuronId prefix', async () => {
        await repo.saveStimulation(
            makeStim('s1', 'a', { startedAt: 100, hasError: true })
        );
        await repo.saveStimulation(
            makeStim('s2', 'a', {
                startedAt: 200,
                collateralId: 'a:cns:special:col',
            })
        );
        await repo.saveStimulation(makeStim('s3', 'a', { startedAt: 300 }));

        expect(
            (await repo.getStimulations('a', { hasError: true })).items.map(
                s => s.id
            )
        ).toEqual(['s1']);

        expect(
            (
                await repo.getStimulations('a', {
                    collateralId: 'a:cns:special:col',
                })
            ).items.map(s => s.id)
        ).toEqual(['s2']);

        expect(
            (
                await repo.getStimulations('a', { neuronId: 'a:cns:special' })
            ).items.map(s => s.id)
        ).toEqual(['s2']);

        const ranged = await repo.getStimulations('a', {
            fromTimestamp: 150,
            toTimestamp: 250,
        });
        expect(ranged.items.map(s => s.id)).toEqual(['s2']);
    });

    it('paginates with limit/offset while reporting full total', async () => {
        for (let i = 0; i < 5; i++)
            await repo.saveStimulation(
                makeStim(`s${i}`, 'a', { startedAt: i })
            );

        const page = await repo.getStimulations('a', { limit: 2, offset: 1 });
        expect(page.total).toBe(5);
        expect(page.items.map(s => s.id)).toEqual(['s3', 's2']);
    });

    it('completes a stimulation', async () => {
        await repo.saveStimulation(makeStim('s1', 'a'));
        await repo.completeStimulation('s1', 5000, 3, true);

        const { items } = await repo.getStimulations('a', {});
        expect(items[0].completedAt).toBe(5000);
        expect(items[0].hopCount).toBe(3);
        expect(items[0].hasError).toBe(true);
    });

    it('stores hops idempotently and returns them ordered by index', async () => {
        await repo.saveHop(makeHop('h2', 's1', 2));
        await repo.saveHop(makeHop('h0', 's1', 0));
        await repo.saveHop(makeHop('h1', 's1', 1));
        await repo.saveHop(makeHop('h1', 's1', 1)); // duplicate id → ignored

        const hops = await repo.getHops('s1');
        expect(hops.map(h => h.index)).toEqual([0, 1, 2]);
        expect(await repo.getHops('none')).toEqual([]);
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
        expect(await repo.getStimulations('nope', {})).toEqual({
            items: [],
            total: 0,
        });
        expect(await repo.getCnsByApp('nope')).toEqual([]);
        expect(await repo.getTopology()).toEqual([]);
    });

    it('reports full total when offset is beyond the range', async () => {
        await repo.saveStimulation(makeStim('s0', 'a', { startedAt: 1 }));
        await repo.saveStimulation(makeStim('s1', 'a', { startedAt: 2 }));

        const page = await repo.getStimulations('a', { offset: 10 });
        expect(page.items).toEqual([]);
        expect(page.total).toBe(2);
    });

    it('ignores completing an unknown stimulation', async () => {
        await expect(
            repo.completeStimulation('ghost', 1, 1, false)
        ).resolves.toBeUndefined();
        expect(await repo.getStimulations('a', {})).toEqual({
            items: [],
            total: 0,
        });
    });
});
