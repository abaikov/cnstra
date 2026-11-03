import { CNSDevToolsServerRepositoryInMemory } from '../src/index';
import type { TCNSTopologySnapshotDTO } from '@cnstra/devtools-server';

const makeTopology = (cnsId: string, appId: string): TCNSTopologySnapshotDTO => ({
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
        test('finds the app of a cns from its topology', () => {
            repo.saveTopology(makeTopology('app-1:cns', 'app-1'));
            expect(repo.findAppByCns('app-1:cns')).toBe('app-1');
        });

        test('findAppByCns returns undefined for unknown cnsId', () => {
            expect(repo.findAppByCns('unknown')).toBeUndefined();
        });
    });

    describe('Clear', () => {
        test('clears all data', () => {
            repo.saveTopology(makeTopology('app-1:cns', 'app-1'));

            repo.clear();

            expect(repo.getTopology()).toEqual([]);
            expect(repo.findAppByCns('app-1:cns')).toBeUndefined();
            expect(repo.findAppByCns('app-1:cns')).toBeUndefined();
        });

        test('clear works on empty repository', () => {
            expect(() => repo.clear()).not.toThrow();
        });
    });
});
