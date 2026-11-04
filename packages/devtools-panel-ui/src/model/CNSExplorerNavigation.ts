import type { TCNSExplorerQuery } from '../types/TCNSExplorerQuery';
import type { TCNSExplorerTab } from '../types/TCNSExplorerTab';
import { CNSExplorerQuery } from './CNSExplorerQuery';
import { CLEAR_SELECTION } from './constants/CLEAR_SELECTION';
import { DEFAULT_EXPLORER_QUERY } from './constants/DEFAULT_EXPLORER_QUERY';
import { NAVIGATION_ENTRY_KINDS } from './constants/NAVIGATION_ENTRY_KINDS';
import type { TCNSNavigationEntryKind } from './types/TCNSNavigationEntryKind';
import type { TCNSNavigationEntryState } from './types/TCNSNavigationEntryState';

export class CNSExplorerNavigation {
    public static queryOfHash(hash: string): TCNSExplorerQuery {
        const queryAt = hash.indexOf('?');
        return queryAt < 0 ? DEFAULT_EXPLORER_QUERY : CNSExplorerQuery.decode(hash.slice(queryAt));
    }

    public static stackOf(query: TCNSExplorerQuery): TCNSNavigationEntryState[] {
        const trail = (query.navTrail ?? []).flatMap((crumb): TCNSNavigationEntryState[] => {
            const kind = crumb.slice(0, crumb.indexOf(':'));
            const id = crumb.slice(crumb.indexOf(':') + 1);
            return CNSExplorerNavigation.isNavigationEntryKind(kind) && id !== '' ? [{ kind, id }] : [];
        });
        if (trail.length > 0) return trail;
        return query.selected ? [{ kind: 'stimulation', id: query.selected }] : [];
    }

    public static withEntityOpened(query: TCNSExplorerQuery, entry: TCNSNavigationEntryState, fresh: boolean): TCNSExplorerQuery {
        return CNSExplorerNavigation.withStack(query, fresh ? [entry] : [...CNSExplorerNavigation.stackOf(query), entry]);
    }

    public static withBack(query: TCNSExplorerQuery): TCNSExplorerQuery {
        return CNSExplorerNavigation.withStack(query, CNSExplorerNavigation.stackOf(query).slice(0, -1));
    }

    public static withCrumb(query: TCNSExplorerQuery, index: number): TCNSExplorerQuery {
        const stack = CNSExplorerNavigation.stackOf(query);
        return index < 0 || index >= stack.length ? query : CNSExplorerNavigation.withStack(query, stack.slice(0, index + 1));
    }

    public static withTabSelected(query: TCNSExplorerQuery, tab: TCNSExplorerTab): TCNSExplorerQuery {
        return { ...query, ...CLEAR_SELECTION, navTrail: undefined, tab };
    }

    private static withStack(query: TCNSExplorerQuery, stack: readonly TCNSNavigationEntryState[]): TCNSExplorerQuery {
        const top = stack[stack.length - 1];
        if (top === undefined) return { ...query, ...CLEAR_SELECTION, navTrail: undefined };
        const navTrail = stack.map(entry => `${entry.kind}:${entry.id}`);
        switch (top.kind) {
            case 'stimulation':
                return { ...query, ...CLEAR_SELECTION, selected: top.id, navTrail };
            case 'neuron':
                return { ...query, ...CLEAR_SELECTION, selectedNeuron: top.id, navTrail };
            case 'collateral':
                return { ...query, ...CLEAR_SELECTION, selectedCollateral: top.id, navTrail };
            case 'task':
                return { ...query, ...CLEAR_SELECTION, selectedTask: top.id, navTrail };
        }
    }

    private static isNavigationEntryKind(value: string): value is TCNSNavigationEntryKind {
        return NAVIGATION_ENTRY_KINDS.some(kind => kind === value);
    }
}
