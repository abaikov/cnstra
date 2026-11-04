import type { TCNSDevToolsSyncKeys } from '@cnstra/devtools-dto';
import type { TCNSExplorerQuery } from '../types/TCNSExplorerQuery';
import { NEURON_SNAPSHOT_LIMIT } from './constants/NEURON_SNAPSHOT_LIMIT';
import { SCHEDULED_PAGE_LIMIT } from './constants/SCHEDULED_PAGE_LIMIT';
import { STIMULATION_PAGE_LIMIT } from './constants/STIMULATION_PAGE_LIMIT';
import { STIMULATION_SNAPSHOT_LIMIT } from './constants/STIMULATION_SNAPSHOT_LIMIT';

type TCNSStimulationFilterParts = [
    scopeName: string | undefined,
    status: string | undefined,
    entryCollateralName: string | undefined,
    neuronName: string | undefined,
    text: string | undefined,
    since: number | undefined,
    until: number | undefined,
];

export class CNSExplorerSyncKeys {
    public static stimulationPage(
        query: TCNSExplorerQuery,
        bounds: { sinceCursor?: string; cursor?: string },
        limit: number = STIMULATION_PAGE_LIMIT
    ): TCNSDevToolsSyncKeys['stimulationPage'] {
        return [...CNSExplorerSyncKeys.filterPartsOf(query), bounds.sinceCursor, bounds.cursor, limit];
    }

    public static stimulationFacets(query: TCNSExplorerQuery): TCNSDevToolsSyncKeys['stimulationFacets'] {
        return [...CNSExplorerSyncKeys.filterPartsOf(query), query.metricPath || undefined];
    }

    public static stimulationSnapshot(query: TCNSExplorerQuery): TCNSDevToolsSyncKeys['stimulationSnapshot'] {
        return [...CNSExplorerSyncKeys.filterPartsOf(query), STIMULATION_SNAPSHOT_LIMIT];
    }

    public static neuronSnapshot(query: TCNSExplorerQuery, neuronName: string): TCNSDevToolsSyncKeys['stimulationSnapshot'] {
        return [query.scopeName || undefined, undefined, undefined, neuronName, undefined, query.since, query.until, NEURON_SNAPSHOT_LIMIT];
    }

    public static scheduledPage(
        filter: { neuronName?: string; collateralName?: string },
        cursor: string | undefined
    ): TCNSDevToolsSyncKeys['scheduledPage'] {
        return [filter.neuronName, filter.collateralName, cursor, SCHEDULED_PAGE_LIMIT];
    }

    public static stimulationDetail(stimulationId: string): TCNSDevToolsSyncKeys['stimulationDetail'] {
        return [stimulationId];
    }

    public static topology(query: TCNSExplorerQuery): TCNSDevToolsSyncKeys['topology'] {
        return [query.scopeName || undefined];
    }

    private static filterPartsOf(query: TCNSExplorerQuery): TCNSStimulationFilterParts {
        return [
            query.scopeName || undefined,
            query.status || undefined,
            query.entryCollateralName || undefined,
            query.neuronName || undefined,
            query.text || undefined,
            query.since,
            query.until,
        ];
    }
}
