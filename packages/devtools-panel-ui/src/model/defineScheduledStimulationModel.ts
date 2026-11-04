import { defineCNSHomeostatModel } from '@cnstra/sync';
import type { TCNSScheduledStimulationState } from '@cnstra/persist-dto';
import type { TCNSDevToolsReceptors } from './types/TCNSDevToolsReceptors';
import type { TCNSScheduledPageSummary } from './types/TCNSScheduledPageSummary';
import { scheduledStimulationAxon } from './axons/scheduledStimulationAxon';
import { KEEP_SYNCED_DATA_AFTER_IDLE_MS } from './constants/KEEP_SYNCED_DATA_AFTER_IDLE_MS';

const scheduledStimulationsChangedOf = (changedRows: readonly TCNSScheduledStimulationState[]) => changedRows.length === 0
    ? undefined
    : scheduledStimulationAxon.scheduledStimulationsChanged.createSignal({ stimulationIds: changedRows.map(row => row.stimulationId) });

export function defineScheduledStimulationModel(homeostatReceptors: TCNSDevToolsReceptors) {
    return defineCNSHomeostatModel(scheduledStimulationAxon)
        .collection('scheduledStimulations', { idOf: (row: TCNSScheduledStimulationState) => row.stimulationId, keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS })
        .homeostatReceptor('scheduledPage', {
            keepAfterIdleMs: KEEP_SYNCED_DATA_AFTER_IDLE_MS,
            homeostatReceptor: homeostatReceptors.scheduledPage,
            bucketsOf: page => ({ scheduledStimulations: page.rows }),
            summaryOf: (page): TCNSScheduledPageSummary => ({ schedules: page.schedules, types: page.types, nextCursor: page.nextCursor, available: page.available }),
            afterWrite: ({ changedEntities }) => scheduledStimulationsChangedOf(changedEntities.scheduledStimulations),
        });
}
