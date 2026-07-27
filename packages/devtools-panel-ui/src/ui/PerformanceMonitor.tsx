import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import { db } from '../model';

// Native Exodra port of the React <PerformanceMonitor> island (the last one). The
// 2s sampling interval lives in onExoMount/onExoUnmount (was useEffect); metrics +
// rolling history are bindables; the panel is a reactive region.
// NOTE: sparklines use declarative <svg><polyline> — if Exodra's JSX runtime doesn't
// namespace SVG they won't draw (verify via e2e); the numeric metrics don't depend on it.

interface CnsMetrics {
    stimulationsPerSecond: number;
    avgResponseTime: number;
    avgHopCount: number;
    activeNeurons: number;
    totalConnections: number;
    queueUtilization: number;
    errorRate: number;
}
interface Metrics {
    memoryUsage: { used: number; total: number; percentage: number };
    renderTime: number;
    timestamp: number;
    cnsMetrics: CnsMetrics;
}
interface History {
    memory: number[];
    timestamps: number[];
    stimulationsPerSecond: number[];
    responseTime: number[];
    hopCount: number[];
    errorRate: number[];
}

const statusColor = (v: number, warning: number, danger: number): string =>
    v >= danger
        ? 'var(--infection-red)'
        : v >= warning
          ? 'var(--infection-yellow)'
          : 'var(--infection-green)';

const emptyHistory = (): History => ({
    memory: [],
    timestamps: [],
    stimulationsPerSecond: [],
    responseTime: [],
    hopCount: [],
    errorRate: [],
});

export function performanceMonitor(): TExoSchema {
    const metricsB = bindable<Metrics | null>(null);
    const historyB = bindable<History>(emptyHistory());
    const isExpandedB = bindable(false);

    let lastMetricsTime = Date.now();
    let lastStimulationCount = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    const memUsage = (): Metrics['memoryUsage'] => {
        if ('memory' in performance) {
            const m = (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
            const used = m.usedJSHeapSize;
            const total = m.totalJSHeapSize;
            return {
                used: Math.round((used / 1024 / 1024) * 100) / 100,
                total: Math.round((total / 1024 / 1024) * 100) / 100,
                percentage: total ? Math.round((used / total) * 100) : 0,
            };
        }
        return { used: 0, total: 0, percentage: 0 };
    };

    const cns = (): CnsMetrics => {
        const responses = db.responses.getAll();
        const stimulations = db.stimulations.getAll();
        const dendrites = db.dendrites.getAll();
        const now = Date.now();
        const timeDiff = (now - lastMetricsTime) / 1000;
        const newStims = stimulations.length - lastStimulationCount;
        const stimulationsPerSecond = timeDiff > 0 ? newStims / timeDiff : 0;
        const withDur = responses.filter(r => r.duration && r.duration > 0);
        const avgResponseTime = withDur.length
            ? withDur.reduce((s, r) => s + (r.duration || 0), 0) / withDur.length
            : 0;
        const avgHopCount = stimulations.length
            ? stimulations.reduce((s, x) => s + x.hopCount, 0) / stimulations.length
            : 0;
        const recentHops = responses.filter(r => r.startedAt > now - 5000);
        const activeNeurons = new Set(recentHops.map(r => r.neuronId)).size;
        const withErr = responses.filter(r => r.error);
        const errorRate = responses.length ? (withErr.length / responses.length) * 100 : 0;
        const round2 = (n: number): number => Math.round(n * 100) / 100;
        return {
            stimulationsPerSecond: round2(stimulationsPerSecond),
            avgResponseTime: round2(avgResponseTime),
            avgHopCount: round2(avgHopCount),
            activeNeurons,
            totalConnections: dendrites.length,
            queueUtilization: 0,
            errorRate: round2(errorRate),
        };
    };

    const update = (): void => {
        const start = performance.now();
        const memoryUsage = memUsage();
        const cnsMetrics = cns();
        const m: Metrics = {
            memoryUsage,
            renderTime: performance.now() - start,
            timestamp: Date.now(),
            cnsMetrics,
        };
        metricsB.setValue(m);
        lastMetricsTime = Date.now();
        lastStimulationCount = db.stimulations.getAll().length;
        const prev = historyB.getValue();
        const MAX = 60;
        historyB.setValue({
            memory: [...prev.memory, memoryUsage.percentage].slice(-MAX),
            timestamps: [...prev.timestamps, m.timestamp].slice(-MAX),
            stimulationsPerSecond: [...prev.stimulationsPerSecond, cnsMetrics.stimulationsPerSecond].slice(-MAX),
            responseTime: [...prev.responseTime, cnsMetrics.avgResponseTime].slice(-MAX),
            hopCount: [...prev.hopCount, cnsMetrics.avgHopCount].slice(-MAX),
            errorRate: [...prev.errorRate, cnsMetrics.errorRate].slice(-MAX),
        });
    };

    const cell = (label: string, value: string, color: string): TExoSchema => (
        <div>
            <span static={{ style: 'color:var(--text-muted)' }}>{label}</span>
            <br />
            <span static={{ style: `color:${color}` }}>{value}</span>
        </div>
    );

    const sparkline = (label: string, data: number[], color: string, latest: string): TExoSchema => {
        const max = Math.max(...data, 1);
        const points = data
            .map((v, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${15 - (v / max) * 15}`)
            .join(' ');
        // Exodra JSX has no SVG element types/runtime; build the sparkline SVG
        // imperatively via innerHTML (the HTML parser namespaces <svg> correctly).
        // stroke via style so the CSS var resolves.
        const svg = `<svg width="100%" height="100%" style="position:absolute"><polyline fill="none" style="stroke:${color};stroke-width:1" points="${points}"/></svg>`;
        return (
            <div>
                <div static={{ style: 'margin-bottom:var(--spacing-xs);color:var(--text-muted);font-size:10px;display:flex;justify-content:space-between' }}>
                    <span>📈 {label} (last {String(data.length)}s)</span>
                    <span static={{ style: `color:${color}` }}>{latest}</span>
                </div>
                <div static={{ style: 'height:15px;background:var(--bg-secondary);border-radius:2px;position:relative;overflow:hidden', onExoMount: (n: { element: unknown }) => { (n.element as HTMLElement).innerHTML = svg; } }} />
            </div>
        );
    };

    const compact = (m: Metrics): TExoSchema => {
        const server = db.serverMetrics.getAll().slice(-1)[0] as
            | { cpuPercent: number; rssMB: number }
            | undefined;
        return (
            <div static={{ style: 'display:flex;gap:var(--spacing-xs);align-items:center;flex-wrap:wrap' }}>
                <div static={{ style: `color:${statusColor(m.memoryUsage.percentage, 70, 90)}` }}>🧠 {String(m.memoryUsage.percentage)}%</div>
                <div static={{ style: 'color:var(--infection-green)' }}>⚡ {String(m.cnsMetrics.stimulationsPerSecond)}/s</div>
                <div static={{ style: 'color:var(--infection-blue)' }}>🎯 {String(m.cnsMetrics.activeNeurons)}n</div>
                {server ? <div static={{ style: `color:${server.cpuPercent > 70 ? 'var(--infection-red)' : 'var(--infection-green)'}` }}>🖥️ {server.cpuPercent.toFixed(1)}% CPU</div> : <div />}
                {server ? <div static={{ style: `color:${server.rssMB > 500 ? 'var(--infection-red)' : server.rssMB > 200 ? 'var(--infection-yellow)' : 'var(--infection-blue)'}` }}>💾 {server.rssMB.toFixed(0)}MB</div> : <div />}
                {m.cnsMetrics.errorRate > 0 ? <div static={{ style: 'color:var(--infection-red)' }}>❌ {String(m.cnsMetrics.errorRate)}%</div> : <div />}
            </div>
        );
    };

    const expanded = (m: Metrics, h: History): TExoSchema => {
        const memColor = statusColor(m.memoryUsage.percentage, 70, 90);
        const cm = m.cnsMetrics;
        const last = (a: number[]): string => (a.length ? a[a.length - 1].toFixed(1) : '0');
        return (
            <div static={{ style: 'display:flex;flex-direction:column;gap:var(--spacing-sm)' }}>
                <div>
                    <div static={{ style: 'display:flex;justify-content:space-between;margin-bottom:var(--spacing-xs)' }}>
                        <span>🧠 Memory</span>
                        <span static={{ style: `color:${memColor}` }}>{String(m.memoryUsage.used)}MB / {String(m.memoryUsage.total)}MB</span>
                    </div>
                    <div static={{ style: 'width:100%;height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden' }}>
                        <div static={{ style: `width:${m.memoryUsage.percentage}%;height:100%;background:${memColor};transition:width 0.3s ease` }} />
                    </div>
                    <div static={{ style: 'text-align:center;color:var(--text-muted);margin-top:2px' }}>{String(m.memoryUsage.percentage)}%</div>
                </div>

                <div static={{ style: 'border-top:1px solid var(--border-infected);padding-top:var(--spacing-sm)' }}>
                    <div static={{ style: 'margin-bottom:var(--spacing-sm);color:var(--infection-green);font-size:11px;font-weight:bold' }}>🧠 CNStra Metrics</div>
                    <div static={{ style: 'display:grid;grid-template-columns:1fr 1fr;gap:var(--spacing-xs);font-size:10px' }}>
                        {cell('⚡ Stimulations/s:', String(cm.stimulationsPerSecond), 'var(--infection-green)')}
                        {cell('🎯 Active Neurons:', String(cm.activeNeurons), 'var(--infection-blue)')}
                        {cell('⏱️ Avg Response:', `${cm.avgResponseTime}ms`, cm.avgResponseTime > 100 ? 'var(--infection-red)' : 'var(--infection-green)')}
                        {cell('🔗 Connections:', String(cm.totalConnections), 'var(--text-primary)')}
                        {cell('🎭 Avg Hops:', String(cm.avgHopCount), cm.avgHopCount > 3 ? 'var(--infection-yellow)' : 'var(--infection-green)')}
                        {cell('📊 Queue Util:', String(cm.queueUtilization), cm.queueUtilization > 10 ? 'var(--infection-red)' : 'var(--infection-green)')}
                    </div>
                    {cm.errorRate > 0 ? <div static={{ style: 'margin-top:var(--spacing-xs);padding:var(--spacing-xs);background:var(--infection-red);border-radius:2px;font-size:10px;color:white' }}>❌ Error Rate: {String(cm.errorRate)}%</div> : <div />}
                </div>

                {h.stimulationsPerSecond.length > 1 ? sparkline('Stimulations Trend', h.stimulationsPerSecond, 'var(--infection-green)', `${last(h.stimulationsPerSecond)}/s`) : <div />}
                {h.memory.length > 1 ? sparkline('Memory Trend', h.memory, memColor, `${last(h.memory)}%`) : <div />}
                {h.responseTime.length > 1 ? sparkline('Response Time', h.responseTime, 'var(--infection-yellow)', `${last(h.responseTime)}ms`) : <div />}
                {h.errorRate.length > 1 ? sparkline('Error Rate', h.errorRate, 'var(--infection-red)', `${last(h.errorRate)}%`) : <div />}
            </div>
        );
    };

    const render = (): TExoSchema => {
        const m = metricsB.getValue();
        if (!m) return <div />;
        const expandedNow = isExpandedB.getValue();
        return (
            <div static={{ style: 'background:var(--bg-panel);border:2px solid var(--border-infected);border-radius:var(--radius-sm);padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-primary);font-family:var(--font-primary);box-shadow:0 0 10px var(--shadow-infection);width:100%' }}>
                <div
                    static={{ style: `display:flex;justify-content:space-between;align-items:center;margin-bottom:${expandedNow ? 'var(--spacing-sm)' : '0'};cursor:pointer` }}
                    handlers={{ onClick: () => isExpandedB.setValue(!isExpandedB.getValue()) }}
                >
                    <span static={{ style: 'color:var(--infection-green)' }}>📊 Performance</span>
                    <span static={{ style: 'color:var(--text-muted)' }}>{expandedNow ? '▼' : '▶'}</span>
                </div>
                {expandedNow ? expanded(m, historyB.getValue()) : compact(m)}
            </div>
        );
    };

    return (
        <div
            static={{ onExoMount: () => { update(); timer = setInterval(update, 2000); }, onExoUnmount: () => { if (timer) clearInterval(timer); } }}
            bindable={{ children: combine([metricsB, historyB, isExpandedB], render) }}
        />
    );
}
