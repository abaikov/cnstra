import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import type { ECNSStimulationStatus } from '@cnstra/persist-dto';
import { FIRST_PAGE } from '../../constants/FIRST_PAGE';
import { STIMULATION_STATUSES } from '../../constants/STIMULATION_STATUSES';
import type { TCNSStatusShare } from '../../types/TCNSStatusShare';
import type { TCNSTone } from '../../types/TCNSTone';
import type { TCNSVitalStat } from '../../types/TCNSVitalStat';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { statusLegendItemMachine } from './statusLegendItemMachine';
import { statusShareSegmentMachine } from './statusShareSegmentMachine';
import { throughputChartMachine } from './throughputChartMachine';
import { vitalStatMachine } from './vitalStatMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const STATUS_TONE: Record<ECNSStimulationStatus, TCNSTone> = { completed: 'green', failed: 'red', running: 'yellow', aborted: 'cyan' };

const RUN_STATS: readonly TCNSVitalStat[] = [
    { label: 'stimulations', tone: 'violet', valueOf: c => CNSExplorerReads.stimulationRowsOf(c, CNSExplorerReads.queryOf(c), FIRST_PAGE).total ?? 0 },
    ...STIMULATION_STATUSES.map((status): TCNSVitalStat => ({ label: status, tone: STATUS_TONE[status], valueOf: c => CNSExplorerReads.statusCountOf(c, status) })),
];

const GRAPH_STATS: readonly TCNSVitalStat[] = [
    { label: 'neurons', tone: 'cyan', valueOf: c => CNSExplorerReads.topologyOf(c)?.neurons.length ?? 0 },
    { label: 'collaterals', tone: 'pink', valueOf: c => CNSExplorerReads.topologyOf(c)?.collaterals.length ?? 0 },
    { label: 'tasks loaded', tone: 'green', valueOf: c => CNSExplorerReads.snapshotOf(c, CNSExplorerReads.queryOf(c)).tasks.length },
];

const graphsSchema = exoJsx<{
    toggle: TExoEventPort; toggleTitle: TExoAttrPort; toggleLabel: TExoTextPort; bodyHidden: TExoAttrPort;
    runStats: TExoChildrenPort; graphStats: TExoChildrenPort; throughput: TExoChildrenPort; segments: TExoChildrenPort; legend: TExoChildrenPort;
}>($ => (
    <div class="exp-graphs">
        <div class="exp-graphs-head">
            <div class="exp-heading exp-graphs-title">Graphs · Vitals</div>
            <div class="exp-spacer" />
            <button class="exp-graphs-toggle" title={$.toggleTitle} onClick={$.toggle}>{$.toggleLabel}</button>
        </div>
        <div class="exp-graphs-body" hidden={$.bodyHidden}>
            <div class="exp-vitals">
                <$.runStats />
                <div class="exp-vitals-rule" />
                <$.graphStats />
            </div>
            <div class="exp-graphs-main">
                <$.throughput />
                <div class="exp-share">
                    <svg class="exp-share-bar" viewBox="0 0 100 1" preserveAspectRatio="none">
                        <g><$.segments /></g>
                    </svg>
                    <div class="exp-share-legend"><$.legend /></div>
                </div>
            </div>
        </div>
    </div>
));
const GraphsPorts = graphsSchema.ports;

const statusShareKeyOf = (share: TCNSStatusShare): ECNSStimulationStatus => share.status;

const graphsBase = createExoMachine(graphsSchema, {
    createInitialState: (c: TCNSDevToolsNode) => {
        c.list(GraphsPorts.runStats, vitalStatMachine, RUN_STATS);
        c.list(GraphsPorts.graphStats, vitalStatMachine, GRAPH_STATS);
        c.one(GraphsPorts.throughput, throughputChartMachine);
        return {
            isCollapsed: false,
            segments: c.keyedList(GraphsPorts.segments, statusShareKeyOf, share => c.build(statusShareSegmentMachine, share), statusShareSegmentMachine.transitions.setStatusShare),
            legend: c.keyedList(GraphsPorts.legend, statusShareKeyOf, share => c.build(statusLegendItemMachine, share), statusLegendItemMachine.transitions.setStatusShare),
        };
    },
});

function showCollapse(c: TExoMachineNodeOf<typeof graphsBase>): void {
    const { isCollapsed } = c.state;
    c.attr(GraphsPorts.bodyHidden, isCollapsed);
    c.attr(GraphsPorts.toggleTitle, isCollapsed ? 'Expand the chart' : 'Collapse the chart (more room for details)');
    c.text(GraphsPorts.toggleLabel, isCollapsed ? '▸ show chart' : '▾ hide chart');
}

function statusSharesOf(c: TCNSDevToolsNode): TCNSStatusShare[] {
    const counts = STIMULATION_STATUSES.map(status => CNSExplorerReads.statusCountOf(c, status));
    const total = counts.reduce((sum, count) => sum + count, 0) || 1;
    let offsetPercent = 0;
    return STIMULATION_STATUSES.map((status, index) => {
        const sharePercent = (counts[index] / total) * 100;
        const share = { status, count: counts[index], offsetPercent, sharePercent };
        offsetPercent += sharePercent;
        return share;
    });
}

function showShares(c: TExoMachineNodeOf<typeof graphsBase>): void {
    const shares = statusSharesOf(c);
    c.state.segments.reconcile(shares);
    c.state.legend.reconcile(shares);
}

export const graphsMachine = composeExoMachine(
    graphsBase,
    m => withExoTransitions(m, {
        toggleChart: c => {
            c.state.isCollapsed = !c.state.isCollapsed;
            showCollapse(c);
        },
    }),
    m => withExoWire(m, c => showCollapse(c)),
    m => {
        const { toggleChart } = m.transitions;
        return withExoHandlers(m, on => {
            on(GraphsPorts.toggle, c => toggleChart(c));
        });
    },
    m => withOIMEffects(m, effect => {
        effect(c => showShares(c));
    })
);
