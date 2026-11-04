import { CNSExplorerSyncKeys } from '../CNSExplorerSyncKeys';
import { CNSExplorerNavigation } from '../CNSExplorerNavigation';
import { CNSTaskKey } from '../../utils/CNSTaskKey';

describe('explorer sync keys', () => {
    it('keys the next page by the cursor the page before it answered', () => {
        expect(CNSExplorerSyncKeys.stimulationPage({ tab: 'stimulations', status: 'failed' }, { cursor: 'c1' })).toEqual([undefined, 'failed', undefined, undefined, undefined, undefined, undefined, undefined, 'c1', 50]);
        expect(CNSExplorerSyncKeys.stimulationPage({ tab: 'stimulations' }, { sinceCursor: 'c1' }, 200)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'c1', undefined, 200]);
    });

    it('turns an empty text filter into an unset key part', () => {
        expect(CNSExplorerSyncKeys.stimulationFacets({ tab: 'stimulations', text: '', metricPath: 'pages' })).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'pages']);
    });
});

describe('explorer navigation', () => {
    it('restores the breadcrumb from the trail, and a bare selected run from the selection', () => {
        expect(CNSExplorerNavigation.stackOf({ tab: 'stimulations', navTrail: ['stimulation:s1', 'task:s1#1:2', 'bogus:x'] })).toEqual([
            { kind: 'stimulation', id: 's1' },
            { kind: 'task', id: 's1#1:2' },
        ]);
        expect(CNSExplorerNavigation.stackOf({ tab: 'stimulations', selected: 's9' })).toEqual([{ kind: 'stimulation', id: 's9' }]);
    });

    it('jumps to a crumb by truncating the trail, and ignores one out of range', () => {
        const query = CNSExplorerNavigation.withEntityOpened(CNSExplorerNavigation.withEntityOpened({ tab: 'neurons' }, { kind: 'neuron', id: 'n' }, true), { kind: 'collateral', id: 'c' }, false);
        expect(CNSExplorerNavigation.withCrumb(query, 0)).toMatchObject({ selectedNeuron: 'n', selectedCollateral: undefined, navTrail: ['neuron:n'] });
        expect(CNSExplorerNavigation.withCrumb(query, 5)).toBe(query);
    });

    it('reads the run of a task from its attempt id', () => {
        expect(CNSTaskKey.stimulationIdOfKey('order-7#2:3')).toBe('order-7');
    });
});
