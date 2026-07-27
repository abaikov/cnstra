import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';
import {
    combine,
    readEntitiesByIndexKey,
    subscribeEntitiesByIndexKey,
} from '../exo/oimdb-bind';
import { db } from '../model';
import type { TStimulation, TDendrite, UINeuron, UIHop } from '../model';

// Native Exodra port of the analytics panel (was a React island). Data comes from
// @oimdb/exodra read/subscribe (flush-safe: subscription callbacks only read the db
// and setValue Exodra bindables — never write to OIMDB); analytics is a pure derive.

interface AnalyticsData {
    totalStimulations: number;
    totalResponses: number;
    totalNeurons: number;
    totalConnections: number;
    avgResponseTime: number;
    errorRate: number;
    throughputMetrics: {
        stimulationsPerSecond: number;
        responsesPerSecond: number;
    };
    topPerformingNeurons: Array<{
        neuronId: string;
        stimulationCount: number;
        avgResponseTime: number;
        errorCount: number;
    }>;
    networkComplexity: {
        maxHops: number;
        avgHops: number;
        hopDistribution: Record<number, number>;
    };
    timeRangeMetrics: {
        last5min: { stimulations: number; responses: number; errors: number };
        last1hour: { stimulations: number; responses: number; errors: number };
        last24hours: {
            stimulations: number;
            responses: number;
            errors: number;
        };
    };
}

type TimeRange = '5min' | '1hour' | '24hours' | 'all';

function computeAnalytics(
    allStimulations: TStimulation[],
    allResponses: UIHop[],
    allNeurons: UINeuron[],
    allDendrites: TDendrite[],
    timeRange: TimeRange
): AnalyticsData | null {
    if (!allStimulations.length && !allResponses.length && !allNeurons.length)
        return null;

    const now = Date.now();
    const timeRanges = {
        '5min': now - 5 * 60 * 1000,
        '1hour': now - 60 * 60 * 1000,
        '24hours': now - 24 * 60 * 60 * 1000,
    };

    const filteredStimulations =
        timeRange === 'all'
            ? allStimulations
            : allStimulations.filter(s => s.startedAt > timeRanges[timeRange]);
    const filteredResponses =
        timeRange === 'all'
            ? allResponses
            : allResponses.filter(r => r.startedAt > timeRanges[timeRange]);

    const totalStimulations = filteredStimulations.length;
    const totalResponses = filteredResponses.length;
    const totalNeurons = allNeurons.length;
    const totalConnections = allDendrites.length;

    const responsesWithDuration = filteredResponses.filter(
        r => r.duration && r.duration > 0
    );
    const avgResponseTime =
        responsesWithDuration.length > 0
            ? responsesWithDuration.reduce(
                  (sum, r) => sum + (r.duration || 0),
                  0
              ) / responsesWithDuration.length
            : 0;

    const responsesWithErrors = filteredResponses.filter(r => r.error);
    const errorRate =
        filteredResponses.length > 0
            ? (responsesWithErrors.length / filteredResponses.length) * 100
            : 0;

    const timeRangeSeconds =
        timeRange === 'all'
            ? 3600
            : { '5min': 300, '1hour': 3600, '24hours': 86400 }[timeRange];
    const throughputMetrics = {
        stimulationsPerSecond: totalStimulations / timeRangeSeconds,
        responsesPerSecond: totalResponses / timeRangeSeconds,
    };

    const neuronStats = new Map<
        string,
        { stimulationCount: number; responseTimes: number[]; errorCount: number }
    >();
    filteredResponses.forEach(resp => {
        const nid = resp.neuronId ?? '(unknown)';
        if (!neuronStats.has(nid))
            neuronStats.set(nid, {
                stimulationCount: 0,
                responseTimes: [],
                errorCount: 0,
            });
        const stats = neuronStats.get(nid)!;
        stats.stimulationCount++;
        if (resp.duration) stats.responseTimes.push(resp.duration);
        if (resp.error) stats.errorCount++;
    });
    const topPerformingNeurons = Array.from(neuronStats.entries())
        .map(([neuronId, stats]) => ({
            neuronId,
            stimulationCount: stats.stimulationCount,
            avgResponseTime:
                stats.responseTimes.length > 0
                    ? stats.responseTimes.reduce((s, t) => s + t, 0) /
                      stats.responseTimes.length
                    : 0,
            errorCount: stats.errorCount,
        }))
        .sort((a, b) => b.stimulationCount - a.stimulationCount)
        .slice(0, 5);

    const stimHopCounts = filteredStimulations.map(s => s.hopCount);
    const maxHops = stimHopCounts.length > 0 ? Math.max(...stimHopCounts) : 0;
    const avgHops =
        stimHopCounts.length > 0
            ? stimHopCounts.reduce((s, h) => s + h, 0) / stimHopCounts.length
            : 0;
    const hopDistribution = {} as Record<number, number>;
    stimHopCounts.forEach(h => {
        hopDistribution[h] = (hopDistribution[h] || 0) + 1;
    });

    const metricsFor = (rangeMs: number) => {
        const cutoff = now - rangeMs;
        const stimsInRange = allStimulations.filter(s => s.startedAt > cutoff);
        const respsInRange = allResponses.filter(r => r.startedAt > cutoff);
        return {
            stimulations: stimsInRange.length,
            responses: respsInRange.length,
            errors: respsInRange.filter(r => r.error).length,
        };
    };

    return {
        totalStimulations,
        totalResponses,
        totalNeurons,
        totalConnections,
        avgResponseTime: Math.round(avgResponseTime * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        throughputMetrics: {
            stimulationsPerSecond:
                Math.round(throughputMetrics.stimulationsPerSecond * 1000) /
                1000,
            responsesPerSecond:
                Math.round(throughputMetrics.responsesPerSecond * 1000) / 1000,
        },
        topPerformingNeurons,
        networkComplexity: {
            maxHops,
            avgHops: Math.round(avgHops * 100) / 100,
            hopDistribution,
        },
        timeRangeMetrics: {
            last5min: metricsFor(5 * 60 * 1000),
            last1hour: metricsFor(60 * 60 * 1000),
            last24hours: metricsFor(24 * 60 * 60 * 1000),
        },
    };
}

function downloadBlob(content: string, mime: string, filename: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── styles (string form for Exodra static bucket) ──
const PANEL =
    'background:var(--bg-panel);border:2px solid var(--border-infected);border-radius:var(--radius-sm);' +
    'padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-primary);' +
    'font-family:var(--font-primary);box-shadow:0 0 10px var(--shadow-infection);width:100%';
const EMPTY =
    'background:var(--bg-panel);border:2px solid var(--border-primary);border-radius:var(--radius-sm);' +
    'padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-muted);text-align:center';
const SECTION = 'border-top:1px solid var(--border-primary);padding-top:var(--spacing-sm)';
const SECTION_H = 'margin-bottom:var(--spacing-xs);font-size:11px;font-weight:bold';
const GRID2 =
    'display:grid;grid-template-columns:1fr 1fr;gap:var(--spacing-xs);font-size:10px';
const MUTED = 'color:var(--text-muted)';
const SELECT =
    'padding:2px 4px;font-size:10px;background:var(--bg-secondary);border:1px solid var(--border-primary);' +
    'border-radius:2px;color:var(--text-primary)';

const metric = (label: string, value: string, color: string): TExoSchema => (
    <div>
        <span static={{ style: MUTED }}>{label}</span>
        <br />
        <span static={{ style: `color:${color}` }}>{value}</span>
    </div>
);

export function analyticsDashboard(
    selectedAppId: TExoBindable<string | null, string | null>
): TExoSchema {
    const isExpanded = bindable(false);
    const timeRange = bindable<TimeRange>('1hour');
    const exportFormat = bindable<'json' | 'csv'>('json');

    const stims = bindable<TStimulation[]>([]);
    const resps = bindable<UIHop[]>([]);
    const neurons = bindable<UINeuron[]>([]);
    const dendrites = bindable<TDendrite[]>([]);

    const notNull = <T,>(a: readonly (T | undefined)[]): T[] =>
        a.filter((x): x is T => x != null);

    let unsubs: Array<() => void> = [];
    const read = (): void => {
        const appId = selectedAppId.getValue() || 'dummy-id';
        stims.setValue(
            notNull(
                readEntitiesByIndexKey(
                    db.stimulations,
                    db.stimulations.indexes.appId,
                    appId
                )
            )
        );
        resps.setValue(
            notNull(
                readEntitiesByIndexKey(
                    db.responses,
                    db.responses.indexes.appId,
                    appId
                )
            )
        );
        neurons.setValue(
            notNull(
                readEntitiesByIndexKey(
                    db.neurons,
                    db.neurons.indexes.appId,
                    appId
                )
            )
        );
        dendrites.setValue(
            notNull(
                readEntitiesByIndexKey(
                    db.dendrites,
                    db.dendrites.indexes.appId,
                    appId
                )
            )
        );
    };
    const wire = (): void => {
        for (const u of unsubs) u();
        unsubs = [];
        const appId = selectedAppId.getValue() || 'dummy-id';
        read();
        unsubs.push(
            subscribeEntitiesByIndexKey(db.stimulations, db.stimulations.indexes.appId, appId, read),
            subscribeEntitiesByIndexKey(db.responses, db.responses.indexes.appId, appId, read),
            subscribeEntitiesByIndexKey(db.neurons, db.neurons.indexes.appId, appId, read),
            subscribeEntitiesByIndexKey(db.dendrites, db.dendrites.indexes.appId, appId, read)
        );
    };
    selectedAppId.subscribe(wire);
    wire();

    const analytics = combine(
        [stims, resps, neurons, dendrites, timeRange],
        () =>
            computeAnalytics(
                stims.getValue(),
                resps.getValue(),
                neurons.getValue(),
                dendrites.getValue(),
                timeRange.getValue()
            )
    );

    const onExport = (): void => {
        const a = analytics.getValue();
        const appId = selectedAppId.getValue();
        if (!a || !appId) return;
        const day = new Date().toISOString().split('T')[0];
        if (exportFormat.getValue() === 'json') {
            downloadBlob(
                JSON.stringify(
                    {
                        timestamp: new Date().toISOString(),
                        appId,
                        timeRange: timeRange.getValue(),
                        analytics: a,
                        rawData: {
                            stimulations: stims.getValue(),
                            responses: resps.getValue(),
                            neurons: neurons.getValue(),
                            dendrites: dendrites.getValue(),
                        },
                    },
                    null,
                    2
                ),
                'application/json',
                `cnstra-analytics-${appId}-${day}.json`
            );
        } else {
            const rows: Array<[string, string | number]> = [
                ['Metric', 'Value'],
                ['Total Stimulations', a.totalStimulations],
                ['Total Responses', a.totalResponses],
                ['Total Neurons', a.totalNeurons],
                ['Total Connections', a.totalConnections],
                ['Avg Response Time (ms)', a.avgResponseTime],
                ['Error Rate (%)', a.errorRate],
                ['Stimulations/sec', a.throughputMetrics.stimulationsPerSecond],
                ['Responses/sec', a.throughputMetrics.responsesPerSecond],
                ['Max Hops', a.networkComplexity.maxHops],
                ['Avg Hops', a.networkComplexity.avgHops],
            ];
            downloadBlob(
                rows.map(r => r.join(',')).join('\n'),
                'text/csv',
                `cnstra-analytics-${appId}-${day}.csv`
            );
        }
    };

    const compact = (a: AnalyticsData | null): TExoSchema => (
        <div static={{ style: 'display:flex;gap:var(--spacing-xs);align-items:center;flex-wrap:wrap' }}>
            {a
                ? [
                      <div static={{ style: 'color:var(--infection-green)' }}>⚡ {String(a.totalStimulations)} stims</div>,
                      <div static={{ style: 'color:var(--infection-blue)' }}>📡 {String(a.totalResponses)} resp</div>,
                      <div static={{ style: 'color:var(--infection-yellow)' }}>⏱️ {String(a.avgResponseTime)}ms avg</div>,
                      ...(a.errorRate > 0
                          ? [<div static={{ style: 'color:var(--infection-red)' }}>❌ {String(a.errorRate)}% errors</div>]
                          : []),
                  ]
                : []}
        </div>
    );

    const controls = (): TExoSchema => {
        const tr = timeRange.getValue();
        const fmt = exportFormat.getValue();
        const opt = (v: string, txt: string, cur: string): TExoSchema => (
            <option static={{ value: v, selected: v === cur }}>{txt}</option>
        );
        return (
            <div static={{ style: 'display:flex;justify-content:space-between;align-items:center;padding-bottom:var(--spacing-xs);border-bottom:1px solid var(--border-primary)' }}>
                <div static={{ style: 'display:flex;gap:var(--spacing-xs);align-items:center' }}>
                    <label static={{ style: 'font-size:10px;color:var(--text-muted)' }}>Time Range:</label>
                    <select
                        static={{ style: SELECT }}
                        handlers={{ onChange: (e: Event) => timeRange.setValue((e.target as HTMLSelectElement).value as TimeRange) }}
                    >
                        {opt('5min', 'Last 5 minutes', tr)}
                        {opt('1hour', 'Last hour', tr)}
                        {opt('24hours', 'Last 24 hours', tr)}
                        {opt('all', 'All time', tr)}
                    </select>
                </div>
                <div static={{ style: 'display:flex;gap:var(--spacing-xs);align-items:center' }}>
                    <select
                        static={{ style: SELECT }}
                        handlers={{ onChange: (e: Event) => exportFormat.setValue((e.target as HTMLSelectElement).value as 'json' | 'csv') }}
                    >
                        {opt('json', 'JSON', fmt)}
                        {opt('csv', 'CSV', fmt)}
                    </select>
                    <button
                        static={{ style: 'padding:2px 6px;font-size:10px;background:var(--infection-yellow);color:black;border:1px solid var(--infection-yellow);border-radius:2px;cursor:pointer' }}
                        handlers={{ onClick: onExport }}
                    >
                        📥 Export
                    </button>
                </div>
            </div>
        );
    };

    const expanded = (a: AnalyticsData | null): TExoSchema => (
        <div static={{ style: 'display:flex;flex-direction:column;gap:var(--spacing-sm)' }}>
            {controls()}
            {a
                ? [
                      // Core metrics
                      <div>
                          <div static={{ style: `${SECTION_H};color:var(--infection-yellow)` }}>📊 Core Metrics ({timeRange.getValue()})</div>
                          <div static={{ style: GRID2 }}>
                              {metric('⚡ Stimulations:', String(a.totalStimulations), 'var(--infection-green)')}
                              {metric('📡 Responses:', String(a.totalResponses), 'var(--infection-blue)')}
                              {metric('🧠 Neurons:', String(a.totalNeurons), 'var(--text-primary)')}
                              {metric('🔗 Connections:', String(a.totalConnections), 'var(--text-primary)')}
                              {metric('⏱️ Avg Response:', `${a.avgResponseTime}ms`, a.avgResponseTime > 100 ? 'var(--infection-red)' : 'var(--infection-green)')}
                              {metric('❌ Error Rate:', `${a.errorRate}%`, a.errorRate > 5 ? 'var(--infection-red)' : 'var(--infection-green)')}
                          </div>
                      </div>,
                      // Throughput
                      <div static={{ style: SECTION }}>
                          <div static={{ style: `${SECTION_H};color:var(--infection-green)` }}>🚀 Throughput</div>
                          <div static={{ style: GRID2 }}>
                              {metric('⚡ Stim/sec:', String(a.throughputMetrics.stimulationsPerSecond), 'var(--infection-green)')}
                              {metric('📡 Resp/sec:', String(a.throughputMetrics.responsesPerSecond), 'var(--infection-blue)')}
                          </div>
                      </div>,
                      // Top neurons
                      ...(a.topPerformingNeurons.length > 0
                          ? [
                                <div static={{ style: SECTION }}>
                                    <div static={{ style: `${SECTION_H};color:var(--infection-blue)` }}>🏆 Top Performing Neurons</div>
                                    <div static={{ style: 'max-height:100px;overflow-y:auto' }}>
                                        {a.topPerformingNeurons.map((n, i) => (
                                            <div static={{ style: 'background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:2px;padding:4px;margin-bottom:2px;font-size:9px' }}>
                                                <div static={{ style: 'display:flex;justify-content:space-between;align-items:center' }}>
                                                    <span static={{ style: 'color:var(--infection-green)' }}>#{String(i + 1)} {n.neuronId}</span>
                                                    <span static={{ style: MUTED }}>{String(n.stimulationCount)} stims</span>
                                                </div>
                                                <div static={{ style: MUTED }}>avg: {n.avgResponseTime.toFixed(1)}ms | errors: {String(n.errorCount)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>,
                            ]
                          : []),
                      // Network complexity
                      <div static={{ style: SECTION }}>
                          <div static={{ style: `${SECTION_H};color:var(--infection-red)` }}>🕸️ Network Complexity</div>
                          <div static={{ style: GRID2 }}>
                              {metric('🎭 Max Hops:', String(a.networkComplexity.maxHops), 'var(--infection-red)')}
                              {metric('📊 Avg Hops:', String(a.networkComplexity.avgHops), 'var(--infection-yellow)')}
                          </div>
                          {Object.keys(a.networkComplexity.hopDistribution).length > 0 ? (
                              <div static={{ style: 'margin-top:var(--spacing-xs)' }}>
                                  <div static={{ style: `${MUTED};font-size:9px;margin-bottom:2px` }}>Hop Distribution:</div>
                                  <div static={{ style: 'font-size:8px;color:var(--text-secondary)' }}>
                                      {Object.entries(a.networkComplexity.hopDistribution).map(([hops, count]) => `${hops}h:${count}`).join(' | ')}
                                  </div>
                              </div>
                          ) : (
                              <div />
                          )}
                      </div>,
                      // Time range summary
                      <div static={{ style: SECTION }}>
                          <div static={{ style: `${SECTION_H};color:var(--infection-blue)` }}>⏰ Time Range Summary</div>
                          <div static={{ style: 'font-size:9px' }}>
                              {(
                                  [
                                      ['Last 5min:', a.timeRangeMetrics.last5min],
                                      ['Last hour:', a.timeRangeMetrics.last1hour],
                                      ['Last 24h:', a.timeRangeMetrics.last24hours],
                                  ] as const
                              ).map(([label, m]) => (
                                  <div static={{ style: 'display:flex;justify-content:space-between;margin-bottom:2px' }}>
                                      <span static={{ style: MUTED }}>{label}</span>
                                      <span static={{ style: 'color:var(--text-primary)' }}>{String(m.stimulations)}s | {String(m.responses)}r | {String(m.errors)}e</span>
                                  </div>
                              ))}
                          </div>
                      </div>,
                  ]
                : []}
        </div>
    );

    const panel = (expandedNow: boolean, a: AnalyticsData | null): TExoSchema => (
        <div static={{ style: PANEL }}>
            <div
                static={{ style: `display:flex;justify-content:space-between;align-items:center;margin-bottom:${expandedNow ? 'var(--spacing-sm)' : '0'};cursor:pointer` }}
                handlers={{ onClick: () => isExpanded.setValue(!isExpanded.getValue()) }}
            >
                <span static={{ style: 'color:var(--infection-yellow)' }}>📊 Analytics Dashboard</span>
                <span static={{ style: MUTED }}>{expandedNow ? '▼' : '▶'}</span>
            </div>
            {expandedNow ? expanded(a) : compact(a)}
        </div>
    );

    const content = combine([selectedAppId, isExpanded, analytics], () =>
        selectedAppId.getValue()
            ? panel(isExpanded.getValue(), analytics.getValue())
            : <div static={{ style: EMPTY }}>📊 Select an app to view analytics</div>
    );

    return <div bindable={{ children: content }} />;
}
