import { defineCNSHomeostatModel } from '@cnstra/sync';
import type { TCNSStimulationRosterRow } from '@cnstra/persist-dto';
import type { TCNSDevToolsReceptors } from './types/TCNSDevToolsReceptors';
import { stimulationAxon } from './axons/stimulationAxon';
import type { TCNSStimulationPageCursor } from './types/TCNSStimulationPageCursor';
import { KEEP_SYNCED_DATA_AFTER_IDLE_MS } from './constants/KEEP_SYNCED_DATA_AFTER_IDLE_MS';

const stimulationsChangedOf = (changedRows: readonly TCNSStimulationRosterRow[]) => changedRows.length === 0
    ? undefined
    : stimulationAxon.stimulationsChanged.createSignal({ stimulationIds: changedRows.map(row => row.stimulationId) });

export function defineStimulationModel(homeostatReceptors: TCNSDevToolsReceptors) {
    return defineCNSHomeostatModel(stimulationAxon)
        .collection('stimulations', { idOf: (row: TCNSStimulationRosterRow) => row.stimulationId, keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS })
        .homeostatReceptor('stimulationPage', {
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            homeostatReceptor: homeostatReceptors.stimulationPage,
            bucketsOf: page => ({ stimulations: page.rows }),
            summaryOf: (page): TCNSStimulationPageCursor => ({ total: page.total, nextCursor: page.nextCursor }),
            afterWrite: ({ changedEntities }) => stimulationsChangedOf(changedEntities.stimulations),
        })
        .homeostatReceptor('stimulationSnapshot', {
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            homeostatReceptor: homeostatReceptors.stimulationSnapshot,
            bucketsOf: snapshot => ({ stimulations: snapshot.stimulations }),
            afterWrite: ({ changedEntities }) => stimulationsChangedOf(changedEntities.stimulations),
        })
        .homeostatReceptor('stimulationFacets', {
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            homeostatReceptor: homeostatReceptors.stimulationFacets,
            summaryOf: facets => facets,
        })
        .homeostatReceptor('stimulationDetail', {
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            homeostatReceptor: homeostatReceptors.stimulationDetail,
            summaryOf: detail => detail,
        });
}
