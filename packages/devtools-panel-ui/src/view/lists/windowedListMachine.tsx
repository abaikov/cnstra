import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoRefPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TExoKeyedList } from '@exodra/list-reconcile';
import { createOIMSingleSourceTrackingComputedService } from '@oimdb/core';
import type { OIMDB, TOIMSameValueGuard } from '@oimdb/core';
import { withOIMEffects } from '@oimdb/exodra';
import { isCNSHomeostatSameValue } from '@cnstra/sync';
import { injectCNS } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { FIRST_PAGE } from '../../constants/FIRST_PAGE';
import type { TCNSListItems } from '../../types/TCNSListItems';
import type { TCNSListRow } from '../../types/TCNSListRow';
import type { TCNSWindowedListOptions } from '../../types/TCNSWindowedListOptions';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const ROW_HEIGHT_PX = 52;
const OVERSCAN_ROW_COUNT = 8;
const NEXT_PAGE_DISTANCE_ROW_COUNT = 8;
const FALLBACK_VIEWPORT_HEIGHT_PX = 600;

const windowedListSchema = exoJsx<{ rowHeight: TExoAttrPort; newestHidden: TExoAttrPort; showNewest: TExoEventPort; scroller: TExoRefPort<HTMLElement>; scroll: TExoEventPort; rowCount: TExoAttrPort; rows: TExoChildrenPort; emptyHidden: TExoAttrPort; emptyText: TExoTextPort }>($ => (
    <div class="windowed-list" style={$.rowHeight}>
        <button class="newest-runs" hidden={$.newestHidden} onClick={$.showNewest}>▲ newer runs above — show the newest</button>
        <div class="exp-scroll windowed-list-scroll" ref={$.scroller} onScroll={$.scroll}>
            <div class="exp-rows windowed-list-rows" style={$.rowCount}><$.rows /></div>
            <div class="windowed-list-empty" hidden={$.emptyHidden}>{$.emptyText}</div>
        </div>
    </div>
));
const WindowedListPorts = windowedListSchema.ports;

const NOTHING_LISTED: TCNSListItems<unknown> = { items: [], emptyText: '' };

const computedReaderOf = <TValue,>(db: OIMDB, derive: () => TValue, initialValue: TValue, sameValueGuard?: TOIMSameValueGuard<TValue>): (() => TValue) => {
    const service = createOIMSingleSourceTrackingComputedService<TValue>({ derive, initialValue, sameValueGuard });
    const single = service.createStoreAggregate(service.createStoreSlot(db));
    return () => single.getSingleSlot().value;
};

type TCNSWindowedListState = {
    rows: TExoKeyedList<TCNSListRow<unknown>>;
    shownRows: ReadonlyMap<unknown, TCNSListRow<unknown>>;
    listName: TCNSWindowedListOptions['listName'];
    listed: () => TCNSListItems<unknown>;
    rowCount: () => string;
    newestHidden: () => boolean;
    emptyHidden: () => boolean;
    emptyText: () => string;
};

const windowedListBase = createExoMachine(windowedListSchema, {
    createInitialState: (c: TCNSDevToolsNode, options: TCNSWindowedListOptions): TCNSWindowedListState => {
        const { db } = c.devTools;
        let lastListed = NOTHING_LISTED;
        const listOf = (): TCNSListItems<unknown> => {
            const paging = options.queryKeyOf === undefined ? FIRST_PAGE : CNSExplorerReads.listPagingOf(c, options.listName, options.queryKeyOf(c));
            const listed = options.itemsOf(c, paging);
            const isShrinkingWhileLoading = listed.pagination?.queryKey === lastListed.pagination?.queryKey
                && listed.pagination?.isLoading === true
                && listed.items.length < lastListed.items.length;
            return isShrinkingWhileLoading ? { ...listed, items: lastListed.items } : listed;
        };
        const listed = computedReaderOf<TCNSListItems<unknown>>(db, () => {
            lastListed = listOf();
            return lastListed;
        }, NOTHING_LISTED, isCNSHomeostatSameValue);
        return {
            rows: options.openRows(c, WindowedListPorts.rows),
            shownRows: new Map(),
            listName: options.listName,
            listed,
            rowCount: computedReaderOf<string>(db, () => `--row-count:${listed().items.length}`, ''),
            newestHidden: computedReaderOf<boolean>(db, () => listed().pagination?.isHeadCut !== true, true),
            emptyHidden: computedReaderOf<boolean>(db, () => listed().items.length > 0, true),
            emptyText: computedReaderOf<string>(db, () => listed().emptyText, ''),
        };
    },
});

function showWindow(c: TExoMachineNodeOf<typeof windowedListBase>): void {
    const scroller = c.portNode(WindowedListPorts.scroller);
    const viewportHeight = scroller.clientHeight || FALLBACK_VIEWPORT_HEIGHT_PX;
    const { items } = c.state.listed();
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROW_COUNT);
    const last = Math.min(items.length, Math.ceil((scroller.scrollTop + viewportHeight) / ROW_HEIGHT_PX) + OVERSCAN_ROW_COUNT);
    const previousRows = c.state.shownRows;
    const shownRows = new Map<unknown, TCNSListRow<unknown>>();
    for (let index = first; index < last; index++) {
        const item = items[index];
        const previousRow = previousRows.get(item);
        shownRows.set(item, previousRow !== undefined && previousRow.index === index ? previousRow : { item, index });
    }
    c.state.shownRows = shownRows;
    c.state.rows.reconcile([...shownRows.values()]);
}

const isNearEnd = (scroller: HTMLElement): boolean =>
    scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - ROW_HEIGHT_PX * NEXT_PAGE_DISTANCE_ROW_COUNT;

export const windowedListMachine = composeExoMachine(
    windowedListBase,
    m => withExoTransitions(m, {
        showNewest: c => {
            c.portNode(WindowedListPorts.scroller).scrollTop = 0;
            injectCNS(c).stimulate(explorerUiAxon.listNewestRequested.createSignal({ listName: c.state.listName }));
        },
        showNextPage: c => {
            const { pagination } = c.state.listed();
            if (pagination === undefined || !pagination.hasMore) return;
            injectCNS(c).stimulate(explorerUiAxon.listNextPageRequested.createSignal({ listName: c.state.listName, queryKey: pagination.queryKey, nextCursor: pagination.nextCursor }));
        },
    }),
    m => withExoWire(m, c => c.attr(WindowedListPorts.rowHeight, `--row-height:${ROW_HEIGHT_PX}px`)),
    m => {
        const { showNewest, showNextPage } = m.transitions;
        return withExoHandlers(m, on => {
            on(WindowedListPorts.showNewest, c => showNewest(c));
            on(WindowedListPorts.scroll, c => {
                showWindow(c);
                if (isNearEnd(c.portNode(WindowedListPorts.scroller))) showNextPage(c);
            });
        });
    },
    m => withOIMEffects(m, effect => {
        effect(c => showWindow(c));
        effect(c => c.attr(WindowedListPorts.rowCount, c.state.rowCount()));
        effect(c => c.attr(WindowedListPorts.newestHidden, c.state.newestHidden()));
        effect(c => c.attr(WindowedListPorts.emptyHidden, c.state.emptyHidden()));
        effect(c => c.text(WindowedListPorts.emptyText, c.state.emptyText()));
    })
);
