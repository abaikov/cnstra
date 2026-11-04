import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoRefPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { injectCNS } from '@cnstra/exodra';
import { withOIMEffects } from '@oimdb/exodra';
import type { TCNSStimulationRosterTimeBucket } from '@cnstra/persist-dto';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSTimeFormat } from '../../utils/CNSTimeFormat';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { signalPulseMachine } from './signalPulseMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const PLOT_WIDTH = 300;
const PLOT_HEIGHT = 96;
const PLOT_VIEW_BOX = `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`;
const AXIS_SHARES = [0, 0.25, 0.5, 0.75, 1];
const PLOT_GRID_PATH = AXIS_SHARES.slice(1, -1).map(share => `M0 ${share * PLOT_HEIGHT} H${PLOT_WIDTH}`).join(' ');
const SHORTEST_BRUSH = 0.02;
const FALLBACK_BUCKET_MS = 60_000;

const throughputChartSchema = exoJsx<{
    mode: TExoAttrPort; showBoth: TExoEventPort; showCompleted: TExoEventPort; showFailed: TExoEventPort;
    surface: TExoRefPort<HTMLElement>; press: TExoEventPort<PointerEvent>; move: TExoEventPort<PointerEvent>; release: TExoEventPort<PointerEvent>; leave: TExoEventPort<PointerEvent>;
    completedArea: TExoAttrPort; completedLine: TExoAttrPort; failedArea: TExoAttrPort; failedLine: TExoAttrPort;
    hoverHidden: TExoAttrPort; hoverAt: TExoAttrPort; completedDotY: TExoAttrPort; failedDotY: TExoAttrPort;
    selectionHidden: TExoAttrPort; selectionX: TExoAttrPort; selectionWidth: TExoAttrPort;
    peak: TExoTextPort; tipHidden: TExoAttrPort; tipSide: TExoAttrPort; tipStamp: TExoTextPort; tipCompleted: TExoTextPort; tipFailed: TExoTextPort;
    axisStart: TExoTextPort; axisQuarter: TExoTextPort; axisMiddle: TExoTextPort; axisThreeQuarters: TExoTextPort; axisEnd: TExoTextPort;
    pulse: TExoChildrenPort;
}>($ => (
    <div class="exp-throughput" title="live throughput chart + new-stimulation pulse" data-mode={$.mode}>
        <div class="exp-throughput-head">
            <span class="exp-heading exp-throughput-title">Throughput</span>
            <span class="exp-live-pill">
                <span class="exp-live-dot" />
                <span>Live</span>
            </span>
            <span class="exp-throughput-hint">drag to pick range</span>
            <div class="exp-spacer" />
            <div class="exp-chart-modes">
                <button class="exp-chart-mode" data-series="both" onClick={$.showBoth}>Both</button>
                <button class="exp-chart-mode" data-series="completed" data-status="completed" onClick={$.showCompleted}>Done</button>
                <button class="exp-chart-mode" data-series="failed" data-status="failed" onClick={$.showFailed}>Failed</button>
            </div>
        </div>
        <div class="exp-chart" ref={$.surface} on:pointerdown={$.press} on:pointermove={$.move} on:pointerup={$.release} on:pointerout={$.leave}>
            <svg class="exp-chart-plot" viewBox={PLOT_VIEW_BOX} preserveAspectRatio="none">
                <path class="exp-chart-grid" d={PLOT_GRID_PATH} />
                <polygon class="exp-chart-area" data-status="completed" points={$.completedArea} />
                <polyline class="exp-chart-line" data-status="completed" points={$.completedLine} />
                <polygon class="exp-chart-area" data-status="failed" points={$.failedArea} />
                <polyline class="exp-chart-line" data-status="failed" points={$.failedLine} />
                <g hidden={$.hoverHidden} transform={$.hoverAt}>
                    <line class="exp-chart-guide" x1="0" x2="0" y1="0" y2={PLOT_HEIGHT} />
                    <circle class="exp-chart-dot" data-status="completed" r="3" cy={$.completedDotY} />
                    <circle class="exp-chart-dot" data-status="failed" r="3" cy={$.failedDotY} />
                </g>
                <rect class="exp-chart-selection" y="0" height={PLOT_HEIGHT} hidden={$.selectionHidden} x={$.selectionX} width={$.selectionWidth} />
            </svg>
            <span class="exp-chart-peak">{$.peak}</span>
            <div class="exp-chart-tip" hidden={$.tipHidden} data-side={$.tipSide}>
                <span class="exp-chart-tip-stamp">{$.tipStamp}</span> · <span data-status="completed">completed <span>{$.tipCompleted}</span></span> · <span data-status="failed">failed <span>{$.tipFailed}</span></span>
            </div>
        </div>
        <div class="exp-chart-axis">
            <span>{$.axisStart}</span>
            <span>{$.axisQuarter}</span>
            <span>{$.axisMiddle}</span>
            <span>{$.axisThreeQuarters}</span>
            <span>{$.axisEnd}</span>
        </div>
        <div class="exp-pulse-box">
            <span class="exp-pulse-label">Signal pulse</span>
            <$.pulse />
        </div>
    </div>
));
const ThroughputChartPorts = throughputChartSchema.ports;
const AXIS_PORTS = [ThroughputChartPorts.axisStart, ThroughputChartPorts.axisQuarter, ThroughputChartPorts.axisMiddle, ThroughputChartPorts.axisThreeQuarters, ThroughputChartPorts.axisEnd];

type TCNSThroughputMode = 'both' | 'completed' | 'failed';

type TCNSThroughputChartState = {
    mode: TCNSThroughputMode;
    buckets: readonly TCNSStimulationRosterTimeBucket[];
    hoverIndex: number | null;
    brushFrom: number | null;
    brushTo: number;
};

const throughputChartBase = createExoMachine(throughputChartSchema, {
    createInitialState: (c: TCNSDevToolsNode): TCNSThroughputChartState => {
        c.one(ThroughputChartPorts.pulse, signalPulseMachine);
        return { mode: 'both', buckets: [], hoverIndex: null, brushFrom: null, brushTo: 0 };
    },
});

type TCNSThroughputChartNode = TExoMachineNodeOf<typeof throughputChartBase>;

const xAt = (count: number, index: number): number => (count <= 1 ? PLOT_WIDTH / 2 : (index / (count - 1)) * PLOT_WIDTH);
const yAt = (peak: number, value: number): number => PLOT_HEIGHT - 2 - (value / peak) * (PLOT_HEIGHT - 6);

function peakOf({ buckets, mode }: TCNSThroughputChartState): number {
    let peak = 1;
    for (const bucket of buckets) {
        if (mode !== 'failed') peak = Math.max(peak, bucket.completed);
        if (mode !== 'completed') peak = Math.max(peak, bucket.failed);
    }
    return peak;
}

function pointsOf(buckets: readonly TCNSStimulationRosterTimeBucket[], peak: number, valueOf: (bucket: TCNSStimulationRosterTimeBucket) => number): string {
    return buckets.map((bucket, index) => `${xAt(buckets.length, index).toFixed(1)},${yAt(peak, valueOf(bucket)).toFixed(1)}`).join(' ');
}

const areaOf = (line: string): string => (line === '' ? '' : `0,${PLOT_HEIGHT} ${line} ${PLOT_WIDTH},${PLOT_HEIGHT}`);

function axisLabelsOf(buckets: readonly TCNSStimulationRosterTimeBucket[]): string[] {
    if (buckets.length === 0) return AXIS_SHARES.map((_share, index) => (index === 0 ? '—' : ''));
    const spanMs = Math.max(0, buckets[buckets.length - 1].tsBucket - buckets[0].tsBucket);
    return AXIS_SHARES.map(share => CNSTimeFormat.axisLabelOf(buckets[Math.round(share * (buckets.length - 1))].tsBucket, spanMs));
}

function brushedRangeOf(buckets: readonly TCNSStimulationRosterTimeBucket[], from: number, to: number): { since: number; until: number } | undefined {
    if (buckets.length < 2 || Math.abs(to - from) < SHORTEST_BRUSH) return undefined;
    const low = Math.round(Math.min(from, to) * (buckets.length - 1));
    const high = Math.round(Math.max(from, to) * (buckets.length - 1));
    const bucketMs = buckets[1].tsBucket - buckets[0].tsBucket || FALLBACK_BUCKET_MS;
    return { since: buckets[low].tsBucket, until: buckets[high].tsBucket + bucketMs };
}

function ratioOf(c: TCNSThroughputChartNode, event: PointerEvent): number {
    const rect = c.portNode(ThroughputChartPorts.surface).getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}

function showPointer(c: TCNSThroughputChartNode): void {
    const { buckets, hoverIndex, brushFrom, brushTo } = c.state;
    const isBrushing = brushFrom !== null;
    c.attr(ThroughputChartPorts.selectionHidden, !isBrushing);
    if (isBrushing) {
        c.attr(ThroughputChartPorts.selectionX, (Math.min(brushFrom, brushTo) * PLOT_WIDTH).toFixed(1));
        c.attr(ThroughputChartPorts.selectionWidth, (Math.abs(brushTo - brushFrom) * PLOT_WIDTH).toFixed(1));
    }
    const bucket = !isBrushing && hoverIndex !== null ? buckets[hoverIndex] : undefined;
    c.attr(ThroughputChartPorts.hoverHidden, bucket === undefined);
    c.attr(ThroughputChartPorts.tipHidden, bucket === undefined);
    if (bucket === undefined || hoverIndex === null) return;
    const peak = peakOf(c.state);
    c.attr(ThroughputChartPorts.hoverAt, `translate(${xAt(buckets.length, hoverIndex).toFixed(1)} 0)`);
    c.attr(ThroughputChartPorts.completedDotY, yAt(peak, bucket.completed).toFixed(1));
    c.attr(ThroughputChartPorts.failedDotY, yAt(peak, bucket.failed).toFixed(1));
    c.attr(ThroughputChartPorts.tipSide, hoverIndex * 2 > buckets.length - 1 ? 'start' : 'end');
    c.text(ThroughputChartPorts.tipStamp, CNSTimeFormat.stampOf(bucket.tsBucket));
    c.text(ThroughputChartPorts.tipCompleted, bucket.completed);
    c.text(ThroughputChartPorts.tipFailed, bucket.failed);
}

function showPlot(c: TCNSThroughputChartNode): void {
    const { buckets, mode } = c.state;
    const peak = peakOf(c.state);
    const completedLine = pointsOf(buckets, peak, bucket => bucket.completed);
    const failedLine = pointsOf(buckets, peak, bucket => bucket.failed);
    c.attr(ThroughputChartPorts.mode, mode);
    c.attr(ThroughputChartPorts.completedLine, completedLine);
    c.attr(ThroughputChartPorts.completedArea, areaOf(completedLine));
    c.attr(ThroughputChartPorts.failedLine, failedLine);
    c.attr(ThroughputChartPorts.failedArea, areaOf(failedLine));
    c.text(ThroughputChartPorts.peak, `peak ${peak}`);
    axisLabelsOf(buckets).forEach((label, index) => c.text(AXIS_PORTS[index], label));
    showPointer(c);
}

export const throughputChartMachine = composeExoMachine(
    throughputChartBase,
    m => withExoTransitions(m, {
        selectMode: (c, mode: TCNSThroughputMode) => {
            c.state.mode = mode;
            showPlot(c);
        },
        startBrush: (c, ratio: number) => {
            if (c.state.buckets.length === 0) return;
            c.state.brushFrom = ratio;
            c.state.brushTo = ratio;
            c.state.hoverIndex = null;
            showPointer(c);
        },
        pointAt: (c, ratio: number) => {
            const { state } = c;
            if (state.brushFrom !== null) state.brushTo = ratio;
            else state.hoverIndex = state.buckets.length === 0 ? null : Math.round(ratio * (state.buckets.length - 1));
            showPointer(c);
        },
        endBrush: (c, ratio: number) => {
            const { brushFrom, buckets } = c.state;
            if (brushFrom === null) return;
            c.state.brushFrom = null;
            showPointer(c);
            const range = brushedRangeOf(buckets, brushFrom, ratio);
            if (range !== undefined) injectCNS(c).stimulate(explorerUiAxon.queryPatched.createSignal({ patch: range }));
        },
        clearPointer: c => {
            if (c.state.brushFrom !== null) return;
            c.state.hoverIndex = null;
            showPointer(c);
        },
    }),
    m => {
        const { selectMode, startBrush, pointAt, endBrush, clearPointer } = m.transitions;
        return withExoHandlers(m, on => {
            on(ThroughputChartPorts.showBoth, c => selectMode(c, 'both'));
            on(ThroughputChartPorts.showCompleted, c => selectMode(c, 'completed'));
            on(ThroughputChartPorts.showFailed, c => selectMode(c, 'failed'));
            on(ThroughputChartPorts.press, (c, event) => {
                c.portNode(ThroughputChartPorts.surface).setPointerCapture(event.pointerId);
                startBrush(c, ratioOf(c, event));
            });
            on(ThroughputChartPorts.move, (c, event) => pointAt(c, ratioOf(c, event)));
            on(ThroughputChartPorts.release, (c, event) => endBrush(c, ratioOf(c, event)));
            on(ThroughputChartPorts.leave, c => clearPointer(c));
        });
    },
    m => withOIMEffects(m, effect => {
        effect(c => {
            c.state.buckets = CNSExplorerReads.facetsOf(c)?.byTime ?? [];
            showPlot(c);
        });
    })
);
