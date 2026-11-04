import { getOIMBucketMemberSlotEntities } from '@oimdb/core';
import type { TOIMEntitySlot, TOIMStoreKey } from '@oimdb/core';
import { ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import type { TCNSHomeostasisState } from '@cnstra/sync';
import type { TCNSDevToolsSyncData, TCNSDevToolsSyncKeys } from '@cnstra/devtools-dto';
import type { ECNSStimulationStatus, TCNSScheduledStimulationState, TCNSStimulationRosterRow } from '@cnstra/persist-dto';
import type { TCNSExplorerSnapshot } from '../../types/TCNSExplorerSnapshot';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';
import { CNSExplorerSyncKeys } from '../../model/CNSExplorerSyncKeys';
import { STIMULATION_HEAD_LIMIT } from '../../model/constants/STIMULATION_HEAD_LIMIT';
import { isStimulationActionAllowed } from '../../model/isStimulationActionAllowed';
import { CNSStimulationDetails } from '../../model/CNSStimulationDetails';
import { listPagingOf } from '../../model/listPagingOf';
import { listPagingStateOf } from '../../model/listPagingStateOf';
import type { TCNSListName } from '../../model/types/TCNSListName';
import { isStimulationRetryable } from '../../model/isStimulationRetryable';
import { EMPTY_EXPLORER_TOPOLOGY } from '../../constants/EMPTY_EXPLORER_TOPOLOGY';
import { EMPTY_STIMULATION_FACETS } from '../../constants/EMPTY_STIMULATION_FACETS';
import type { TCNSActionFeedback } from '../../model/types/TCNSActionFeedback';
import type { TCNSDevToolsConnection } from '../../model/types/TCNSDevToolsConnection';
import type { TCNSStimulationActionName } from '../../model/types/TCNSStimulationActionName';
import type { TCNSScheduledPageSummary } from '../../model/types/TCNSScheduledPageSummary';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';
import type { TCNSListPaging } from '../../types/TCNSListPaging';
import type { TCNSPagedRows } from '../../types/TCNSPagedRows';
import type { TCNSScheduledFilter } from '../../types/TCNSScheduledFilter';
import type { TCNSStimulationRows } from '../../types/TCNSStimulationRows';

export class CNSExplorerReads {
    public static queryOf(c: TCNSDevToolsNode): TCNSExplorerQuery {
        return c.devTools.readExplorerQuery();
    }

    public static facetsOf(c: TCNSDevToolsNode, query: TCNSExplorerQuery = CNSExplorerReads.queryOf(c)) {
        return c.devTools.models.stimulationFacets.getSlotByKey(CNSExplorerSyncKeys.stimulationFacets(query)).entity ?? EMPTY_STIMULATION_FACETS;
    }

    public static topologyOf(c: TCNSDevToolsNode, query: TCNSExplorerQuery = CNSExplorerReads.queryOf(c)) {
        return c.devTools.models.topology.getSlotByKey(CNSExplorerSyncKeys.topology(query)).entity ?? EMPTY_EXPLORER_TOPOLOGY;
    }

    public static statusCountOf(c: TCNSDevToolsNode, status: ECNSStimulationStatus): number {
        return CNSExplorerReads.facetsOf(c).byStatus.find(bucket => bucket.status === status)?.count ?? 0;
    }

    public static stimulationRowsOf(c: TCNSDevToolsNode, query: TCNSExplorerQuery, paging: TCNSListPaging): TCNSStimulationRows {
        const rows: TCNSStimulationRosterRow[] = [];
        const listed = CNSExplorerReads.readStimulationPages(c, query, paging, memberSlots => rows.push(...getOIMBucketMemberSlotEntities(memberSlots)));
        return { ...listed, rows };
    }

    public static stimulationOf(c: TCNSDevToolsNode, stimulationId: string): TCNSStimulationRosterRow | undefined {
        return c.devTools.models.stimulations.getSlotByKey(stimulationId).entity;
    }

    public static stimulationIdsOf(
        c: TCNSDevToolsNode,
        query: TCNSExplorerQuery,
        paging: TCNSListPaging
    ): TCNSPagedRows<string> & { nextCursor: string | null; isHeadCut: boolean } {
        const rows: string[] = [];
        const listed = CNSExplorerReads.readStimulationPages(c, query, paging, memberSlots => {
            for (const { key } of memberSlots) if (typeof key === 'string') rows.push(key);
        });
        return { ...listed, rows };
    }

    public static scheduledStimulationOf(c: TCNSDevToolsNode, stimulationId: string): TCNSScheduledStimulationState | undefined {
        return c.devTools.models.scheduledStimulations.getSlotByKey(stimulationId).entity;
    }

    public static scheduledStimulationIdsOf(
        c: TCNSDevToolsNode,
        filter: TCNSScheduledFilter,
        pageCount: number
    ): TCNSPagedRows<string> & { first: TCNSScheduledPageSummary | undefined } {
        const rows: string[] = [];
        let first: TCNSScheduledPageSummary | undefined;
        const listed = CNSExplorerReads.readScheduledPages(c, filter, pageCount, (memberSlots, summary) => {
            first ??= summary;
            for (const { key } of memberSlots) if (typeof key === 'string') rows.push(key);
        });
        return { ...listed, rows, first };
    }

    public static scheduledRowsOf(
        c: TCNSDevToolsNode,
        filter: TCNSScheduledFilter,
        pageCount: number
    ): TCNSPagedRows<TCNSScheduledStimulationState> & { first: TCNSDevToolsSyncData['scheduledPage'] | undefined } {
        const rows: TCNSScheduledStimulationState[] = [];
        let first: TCNSDevToolsSyncData['scheduledPage'] | undefined;
        const listed = CNSExplorerReads.readScheduledPages(c, filter, pageCount, (memberSlots, summary) => {
            const pageRows = getOIMBucketMemberSlotEntities(memberSlots);
            first ??= { ...summary, rows: pageRows };
            rows.push(...pageRows);
        });
        return { ...listed, rows, first };
    }

    private static readStimulationPages(
        c: TCNSDevToolsNode,
        query: TCNSExplorerQuery,
        paging: TCNSListPaging,
        readPage: (memberSlots: readonly TOIMEntitySlot<TCNSStimulationRosterRow, TOIMStoreKey>[]) => void
    ): Omit<TCNSStimulationRows, 'rows'> {
        const { stimulationPages, stimulationPageCursors, stimulationPageHomeostasis } = c.devTools.models;
        const keys = paging.cursors.length === 0
            ? [CNSExplorerSyncKeys.stimulationPage(query, {})]
            : [CNSExplorerSyncKeys.stimulationPage(query, { sinceCursor: paging.cursors[0] }, STIMULATION_HEAD_LIMIT), ...paging.cursors.map(cursor => CNSExplorerSyncKeys.stimulationPage(query, { cursor }))];
        const seen = new Set<unknown>();
        let total: number | undefined;
        let isHeadCut = false;
        let nextCursor: string | null = null;
        for (const [index, key] of keys.entries()) {
            const memberSlots = stimulationPages.getSlotByKey(key).getBucketMemberSlots();
            const pageCursor = stimulationPageCursors.getSlotByKey(key).entity;
            if (pageCursor === undefined) {
                const isFailed = stimulationPageHomeostasis.getSlotByKey(key).value.status === ECNSHomeostatCorrectionStatus.Failed;
                return { hasMore: false, isLoading: !isFailed, total, nextCursor: null, isHeadCut };
            }
            total ??= pageCursor.total;
            if (index === 0 && keys.length > 1) isHeadCut = pageCursor.nextCursor !== null;
            const unseenSlots: TOIMEntitySlot<TCNSStimulationRosterRow, TOIMStoreKey>[] = [];
            for (const memberSlot of memberSlots) {
                if (seen.has(memberSlot.key)) continue;
                seen.add(memberSlot.key);
                unseenSlots.push(memberSlot);
            }
            readPage(unseenSlots);
            nextCursor = pageCursor.nextCursor;
        }
        return { hasMore: nextCursor !== null, isLoading: false, total, nextCursor, isHeadCut };
    }

    private static readScheduledPages(
        c: TCNSDevToolsNode,
        filter: TCNSScheduledFilter,
        pageCount: number,
        readPage: (memberSlots: Iterable<TOIMEntitySlot<TCNSScheduledStimulationState, TOIMStoreKey>>, summary: TCNSScheduledPageSummary) => void
    ): Omit<TCNSPagedRows<never>, 'rows'> {
        const { scheduledPages, scheduledPageSummaries } = c.devTools.models;
        let cursor: string | undefined;
        for (let page = 0; page < pageCount; page++) {
            const key = CNSExplorerSyncKeys.scheduledPage(filter, cursor);
            const memberSlots = scheduledPages.getSlotByKey(key).getBucketMemberSlots();
            const summary = scheduledPageSummaries.getSlotByKey(key).entity;
            if (summary === undefined) return { hasMore: false, isLoading: true, total: undefined };
            readPage(memberSlots, summary);
            if (!summary.nextCursor) return { hasMore: false, isLoading: false, total: undefined };
            cursor = summary.nextCursor;
        }
        return { hasMore: true, isLoading: false, total: undefined };
    }

    public static detailOf(c: TCNSDevToolsNode, stimulationId: string): TCNSDevToolsSyncData['stimulationDetail'] | undefined {
        return CNSStimulationDetails.read(c.devTools.models.stimulationDetails, stimulationId);
    }

    public static stimulationDetailHomeostasisOf(c: TCNSDevToolsNode, stimulationId: string): TCNSHomeostasisState<TCNSDevToolsSyncKeys['stimulationDetail']> {
        return c.devTools.models.stimulationDetailHomeostasis.getSlotByKey(CNSExplorerSyncKeys.stimulationDetail(stimulationId)).value;
    }

    public static snapshotOfRows(c: TCNSDevToolsNode, rows: readonly TCNSStimulationRosterRow[]): TCNSExplorerSnapshot {
        const snapshot: TCNSExplorerSnapshot = { stimulations: [...rows], attempts: [], tasks: [] };
        for (const row of rows) {
            const detail = CNSExplorerReads.detailOf(c, row.stimulationId);
            if (detail === undefined) continue;
            snapshot.attempts.push(...detail.attempts);
            snapshot.tasks.push(...detail.tasks);
        }
        return snapshot;
    }

    public static snapshotOf(c: TCNSDevToolsNode, query: TCNSExplorerQuery): TCNSExplorerSnapshot {
        return CNSExplorerReads.snapshotOfRows(c, getOIMBucketMemberSlotEntities(c.devTools.models.stimulationSnapshots.getSlotByKey(CNSExplorerSyncKeys.stimulationSnapshot(query)).getBucketMemberSlots()));
    }

    public static neuronSnapshotOf(c: TCNSDevToolsNode, neuronName: string): TCNSExplorerSnapshot {
        const query = CNSExplorerReads.queryOf(c);
        const neuronRows = getOIMBucketMemberSlotEntities(c.devTools.models.stimulationSnapshots.getSlotByKey(CNSExplorerSyncKeys.neuronSnapshot(query, neuronName)).getBucketMemberSlots());
        return neuronRows.length > 0 ? CNSExplorerReads.snapshotOfRows(c, neuronRows) : CNSExplorerReads.snapshotOf(c, query);
    }

    public static actionFeedbackOf(c: TCNSDevToolsNode): TCNSActionFeedback | undefined {
        return c.devTools.models.actionFeedback.getSingleSlot().entity;
    }

    public static connectionOf(c: TCNSDevToolsNode): TCNSDevToolsConnection | undefined {
        return c.devTools.models.connection.getSingleSlot().entity;
    }

    public static listPagingOf(c: TCNSDevToolsNode, listName: TCNSListName, queryKey: string): TCNSListPaging {
        return listPagingOf(listPagingStateOf(c.devTools.models.listPagings, listName), queryKey);
    }

    public static isStimulationRetryable(c: TCNSDevToolsNode, stimulationId: string): boolean {
        return isStimulationRetryable(CNSExplorerReads.detailOf(c, stimulationId));
    }

    public static isStimulationActionAllowed(c: TCNSDevToolsNode, actionName: TCNSStimulationActionName): boolean {
        return isStimulationActionAllowed(CNSExplorerReads.connectionOf(c), actionName);
    }

    public static appNameOf(c: TCNSDevToolsNode): string | undefined {
        return c.devTools.models.apps.getSlotByKey([CNSExplorerReads.queryOf(c).scopeName || undefined]).entity?.apps[0]?.name;
    }
}
