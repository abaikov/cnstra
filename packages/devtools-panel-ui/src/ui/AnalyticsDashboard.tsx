import React, { useState, useMemo } from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

interface Props {
    selectedAppId: string | null;
}

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

export const AnalyticsDashboard: React.FC<Props> = ({ selectedAppId }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [timeRange, setTimeRange] = useState<
        '5min' | '1hour' | '24hours' | 'all'
    >('1hour');
    const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');

    // Get all data for the selected app
    const allStimulations = useSelectEntitiesByIndexKey(
        db.stimulations,
        db.stimulations.indexes.appId,
        selectedAppId || 'dummy-id'
    );

    const allResponses = useSelectEntitiesByIndexKey(
        db.responses,
        db.responses.indexes.appId,
        selectedAppId || 'dummy-id'
    );

    const allNeurons = useSelectEntitiesByIndexKey(
        db.neurons,
        db.neurons.indexes.appId,
        selectedAppId || 'dummy-id'
    );

    const allDendrites = useSelectEntitiesByIndexKey(
        db.dendrites,
        db.dendrites.indexes.appId,
        selectedAppId || 'dummy-id'
    );

    // Calculate comprehensive analytics
    const analytics = useMemo((): AnalyticsData | null => {
        if (!allStimulations || !allResponses || !allNeurons || !allDendrites)
            return null;

        const now = Date.now();
        const timeRanges = {
            '5min': now - 5 * 60 * 1000,
            '1hour': now - 60 * 60 * 1000,
            '24hours': now - 24 * 60 * 60 * 1000,
        };

        // Filter data by time range if not 'all'
        const filteredStimulations =
            timeRange === 'all'
                ? allStimulations
                : allStimulations.filter(
                      s => s.timestamp > timeRanges[timeRange]
                  );

        const filteredResponses =
            timeRange === 'all'
                ? allResponses
                : allResponses.filter(r => r.timestamp > timeRanges[timeRange]);

        // Basic metrics
        const totalStimulations = filteredStimulations.length;
        const totalResponses = filteredResponses.length;
        const totalNeurons = allNeurons.length;
        const totalConnections = allDendrites.length;

        // Response time analysis
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

        // Error rate
        const responsesWithErrors = filteredResponses.filter(r => r.error);
        const errorRate =
            filteredResponses.length > 0
                ? (responsesWithErrors.length / filteredResponses.length) * 100
                : 0;

        // Throughput metrics (only for time-filtered data)
        const timeRangeSeconds =
            timeRange === 'all'
                ? 3600
                : {
                      '5min': 300,
                      '1hour': 3600,
                      '24hours': 86400,
                  }[timeRange];

        const throughputMetrics = {
            stimulationsPerSecond: totalStimulations / timeRangeSeconds,
            responsesPerSecond: totalResponses / timeRangeSeconds,
        };

        // Top performing neurons
        const neuronStats = new Map<
            string,
            {
                stimulationCount: number;
                responseTimes: number[];
                errorCount: number;
            }
        >();

        filteredStimulations.forEach(stim => {
            if (!neuronStats.has(stim.neuronId)) {
                neuronStats.set(stim.neuronId, {
                    stimulationCount: 0,
                    responseTimes: [],
                    errorCount: 0,
                });
            }
            neuronStats.get(stim.neuronId)!.stimulationCount++;
        });

        filteredResponses.forEach(resp => {
            if (neuronStats.has(resp?.neuronId || '')) {
                const stats = neuronStats.get(resp?.neuronId || '')!;
                if (resp.duration) {
                    stats.responseTimes.push(resp.duration);
                }
                if (resp.error) {
                    stats.errorCount++;
                }
            }
        });

        const topPerformingNeurons = Array.from(neuronStats.entries())
            .map(([neuronId, stats]) => ({
                neuronId,
                stimulationCount: stats.stimulationCount,
                avgResponseTime:
                    stats.responseTimes.length > 0
                        ? stats.responseTimes.reduce(
                              (sum, time) => sum + time,
                              0
                          ) / stats.responseTimes.length
                        : 0,
                errorCount: stats.errorCount,
            }))
            .sort((a, b) => b.stimulationCount - a.stimulationCount)
            .slice(0, 5);

        // Network complexity analysis (hops not available in StimulationResponse DTO)
        const maxHops = 0;
        const avgHops = 0;

        const hopDistribution = {} as Record<number, number>;

        // Time range metrics
        const getMetricsForTimeRange = (rangeMs: number) => {
            const cutoff = now - rangeMs;
            const stimsInRange = allStimulations.filter(
                s => s.timestamp > cutoff
            );
            const respsInRange = allResponses.filter(r => r.timestamp > cutoff);
            const errorsInRange = respsInRange.filter(r => r.error);

            return {
                stimulations: stimsInRange.length,
                responses: respsInRange.length,
                errors: errorsInRange.length,
            };
        };

        const timeRangeMetrics = {
            last5min: getMetricsForTimeRange(5 * 60 * 1000),
            last1hour: getMetricsForTimeRange(60 * 60 * 1000),
            last24hours: getMetricsForTimeRange(24 * 60 * 60 * 1000),
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
                    Math.round(throughputMetrics.responsesPerSecond * 1000) /
                    1000,
            },
            topPerformingNeurons,
            networkComplexity: {
                maxHops,
                avgHops: Math.round(avgHops * 100) / 100,
                hopDistribution,
            },
            timeRangeMetrics,
        };
    }, [allStimulations, allResponses, allNeurons, allDendrites, timeRange]);

    const handleExportData = () => {
        if (!analytics || !selectedAppId) return;

        const exportData = {
            timestamp: new Date().toISOString(),
            appId: selectedAppId,
            timeRange,
            analytics,
            rawData: {
                stimulations: allStimulations,
                responses: allResponses,
                neurons: allNeurons,
                dendrites: allDendrites,
            },
        };

        if (exportFormat === 'json') {
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cnstra-analytics-${selectedAppId}-${
                new Date().toISOString().split('T')[0]
            }.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            // CSV export - simplified format
            const csvRows = [
                ['Metric', 'Value'],
                ['Total Stimulations', analytics.totalStimulations],
                ['Total Responses', analytics.totalResponses],
                ['Total Neurons', analytics.totalNeurons],
                ['Total Connections', analytics.totalConnections],
                ['Avg Response Time (ms)', analytics.avgResponseTime],
                ['Error Rate (%)', analytics.errorRate],
                [
                    'Stimulations/sec',
                    analytics.throughputMetrics.stimulationsPerSecond,
                ],
                [
                    'Responses/sec',
                    analytics.throughputMetrics.responsesPerSecond,
                ],
                ['Max Hops', analytics.networkComplexity.maxHops],
                ['Avg Hops', analytics.networkComplexity.avgHops],
            ];

            const csvContent = csvRows.map(row => row.join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cnstra-analytics-${selectedAppId}-${
                new Date().toISOString().split('T')[0]
            }.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    if (!selectedAppId) {
        return (
            <div
                style={{
                    background: 'var(--bg-panel)',
                    border: '2px solid var(--border-primary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--spacing-sm)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                }}
            >
                📊 Select an app to view analytics
            </div>
        );
    }

    return (
        <div
            style={{
                background: 'var(--bg-panel)',
                border: '2px solid var(--border-infected)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--spacing-sm)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-primary)',
                boxShadow: '0 0 10px var(--shadow-infection)',
                width: '100%',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: isExpanded ? 'var(--spacing-sm)' : '0',
                    cursor: 'pointer',
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <span style={{ color: 'var(--infection-yellow)' }}>
                    📊 Analytics Dashboard
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                    {isExpanded ? '▼' : '▶'}
                </span>
            </div>

            {!isExpanded ? (
                // Compact view
                <div
                    style={{
                        display: 'flex',
                        gap: 'var(--spacing-xs)',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    {analytics && (
                        <>
                            <div style={{ color: 'var(--infection-green)' }}>
                                ⚡ {analytics.totalStimulations} stims
                            </div>
                            <div style={{ color: 'var(--infection-blue)' }}>
                                📡 {analytics.totalResponses} resp
                            </div>
                            <div style={{ color: 'var(--infection-yellow)' }}>
                                ⏱️ {analytics.avgResponseTime}ms avg
                            </div>
                            {analytics.errorRate > 0 && (
                                <div style={{ color: 'var(--infection-red)' }}>
                                    ❌ {analytics.errorRate}% errors
                                </div>
                            )}
                        </>
                    )}
                </div>
            ) : (
                // Expanded view
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--spacing-sm)',
                    }}
                >
                    {/* Time Range & Export Controls */}
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            paddingBottom: 'var(--spacing-xs)',
                            borderBottom: '1px solid var(--border-primary)',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                gap: 'var(--spacing-xs)',
                                alignItems: 'center',
                            }}
                        >
                            <label
                                style={{
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                }}
                            >
                                Time Range:
                            </label>
                            <select
                                value={timeRange}
                                onChange={e =>
                                    setTimeRange(e.target.value as any)
                                }
                                style={{
                                    padding: '2px 4px',
                                    fontSize: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: '2px',
                                    color: 'var(--text-primary)',
                                }}
                            >
                                <option value="5min">Last 5 minutes</option>
                                <option value="1hour">Last hour</option>
                                <option value="24hours">Last 24 hours</option>
                                <option value="all">All time</option>
                            </select>
                        </div>

                        <div
                            style={{
                                display: 'flex',
                                gap: 'var(--spacing-xs)',
                                alignItems: 'center',
                            }}
                        >
                            <select
                                value={exportFormat}
                                onChange={e =>
                                    setExportFormat(e.target.value as any)
                                }
                                style={{
                                    padding: '2px 4px',
                                    fontSize: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: '2px',
                                    color: 'var(--text-primary)',
                                }}
                            >
                                <option value="json">JSON</option>
                                <option value="csv">CSV</option>
                            </select>
                            <button
                                onClick={handleExportData}
                                disabled={!analytics}
                                style={{
                                    padding: '2px 6px',
                                    fontSize: '10px',
                                    background: analytics
                                        ? 'var(--infection-yellow)'
                                        : 'var(--bg-secondary)',
                                    color: analytics
                                        ? 'black'
                                        : 'var(--text-muted)',
                                    border: `1px solid ${
                                        analytics
                                            ? 'var(--infection-yellow)'
                                            : 'var(--border-primary)'
                                    }`,
                                    borderRadius: '2px',
                                    cursor: analytics
                                        ? 'pointer'
                                        : 'not-allowed',
                                }}
                            >
                                📥 Export
                            </button>
                        </div>
                    </div>

                    {analytics && (
                        <>
                            {/* Core Metrics */}
                            <div>
                                <div
                                    style={{
                                        marginBottom: 'var(--spacing-xs)',
                                        color: 'var(--infection-yellow)',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    📊 Core Metrics ({timeRange})
                                </div>

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 1fr',
                                        gap: 'var(--spacing-xs)',
                                        fontSize: '10px',
                                    }}
                                >
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            ⚡ Stimulations:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--infection-green)',
                                            }}
                                        >
                                            {analytics.totalStimulations}
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            📡 Responses:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--infection-blue)',
                                            }}
                                        >
                                            {analytics.totalResponses}
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            🧠 Neurons:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            {analytics.totalNeurons}
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            ⏱️ Avg Response:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color:
                                                    analytics.avgResponseTime >
                                                    100
                                                        ? 'var(--infection-red)'
                                                        : 'var(--infection-green)',
                                            }}
                                        >
                                            {analytics.avgResponseTime}ms
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            ❌ Error Rate:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color:
                                                    analytics.errorRate > 5
                                                        ? 'var(--infection-red)'
                                                        : 'var(--infection-green)',
                                            }}
                                        >
                                            {analytics.errorRate}%
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            🔗 Connections:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            {analytics.totalConnections}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Throughput Metrics */}
                            <div
                                style={{
                                    borderTop:
                                        '1px solid var(--border-primary)',
                                    paddingTop: 'var(--spacing-sm)',
                                }}
                            >
                                <div
                                    style={{
                                        marginBottom: 'var(--spacing-xs)',
                                        color: 'var(--infection-green)',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    🚀 Throughput
                                </div>

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 'var(--spacing-xs)',
                                        fontSize: '10px',
                                    }}
                                >
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            ⚡ Stim/sec:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--infection-green)',
                                            }}
                                        >
                                            {
                                                analytics.throughputMetrics
                                                    .stimulationsPerSecond
                                            }
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            📡 Resp/sec:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--infection-blue)',
                                            }}
                                        >
                                            {
                                                analytics.throughputMetrics
                                                    .responsesPerSecond
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Top Performing Neurons */}
                            {analytics.topPerformingNeurons.length > 0 && (
                                <div
                                    style={{
                                        borderTop:
                                            '1px solid var(--border-primary)',
                                        paddingTop: 'var(--spacing-sm)',
                                    }}
                                >
                                    <div
                                        style={{
                                            marginBottom: 'var(--spacing-xs)',
                                            color: 'var(--infection-blue)',
                                            fontSize: '11px',
                                            fontWeight: 'bold',
                                        }}
                                    >
                                        🏆 Top Performing Neurons
                                    </div>

                                    <div
                                        style={{
                                            maxHeight: '100px',
                                            overflowY: 'auto',
                                        }}
                                    >
                                        {analytics.topPerformingNeurons.map(
                                            (neuron, index) => (
                                                <div
                                                    key={neuron.neuronId}
                                                    style={{
                                                        background:
                                                            'var(--bg-secondary)',
                                                        border: '1px solid var(--border-primary)',
                                                        borderRadius: '2px',
                                                        padding: '4px',
                                                        marginBottom: '2px',
                                                        fontSize: '9px',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent:
                                                                'space-between',
                                                            alignItems:
                                                                'center',
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                color: 'var(--infection-green)',
                                                            }}
                                                        >
                                                            #{index + 1}{' '}
                                                            {neuron.neuronId}
                                                        </span>
                                                        <span
                                                            style={{
                                                                color: 'var(--text-muted)',
                                                            }}
                                                        >
                                                            {
                                                                neuron.stimulationCount
                                                            }{' '}
                                                            stims
                                                        </span>
                                                    </div>
                                                    <div
                                                        style={{
                                                            color: 'var(--text-muted)',
                                                        }}
                                                    >
                                                        avg:{' '}
                                                        {neuron.avgResponseTime.toFixed(
                                                            1
                                                        )}
                                                        ms | errors:{' '}
                                                        {neuron.errorCount}
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Network Complexity */}
                            <div
                                style={{
                                    borderTop:
                                        '1px solid var(--border-primary)',
                                    paddingTop: 'var(--spacing-sm)',
                                }}
                            >
                                <div
                                    style={{
                                        marginBottom: 'var(--spacing-xs)',
                                        color: 'var(--infection-red)',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    🕸️ Network Complexity
                                </div>

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 'var(--spacing-xs)',
                                        fontSize: '10px',
                                    }}
                                >
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            🎭 Max Hops:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--infection-red)',
                                            }}
                                        >
                                            {
                                                analytics.networkComplexity
                                                    .maxHops
                                            }
                                        </span>
                                    </div>
                                    <div>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            📊 Avg Hops:
                                        </span>
                                        <br />
                                        <span
                                            style={{
                                                color: 'var(--infection-yellow)',
                                            }}
                                        >
                                            {
                                                analytics.networkComplexity
                                                    .avgHops
                                            }
                                        </span>
                                    </div>
                                </div>

                                {Object.keys(
                                    analytics.networkComplexity.hopDistribution
                                ).length > 0 && (
                                    <div
                                        style={{
                                            marginTop: 'var(--spacing-xs)',
                                        }}
                                    >
                                        <div
                                            style={{
                                                color: 'var(--text-muted)',
                                                fontSize: '9px',
                                                marginBottom: '2px',
                                            }}
                                        >
                                            Hop Distribution:
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '8px',
                                                color: 'var(--text-secondary)',
                                            }}
                                        >
                                            {Object.entries(
                                                analytics.networkComplexity
                                                    .hopDistribution
                                            )
                                                .map(
                                                    ([hops, count]) =>
                                                        `${hops}h:${count}`
                                                )
                                                .join(' | ')}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Time Range Summary */}
                            <div
                                style={{
                                    borderTop:
                                        '1px solid var(--border-primary)',
                                    paddingTop: 'var(--spacing-sm)',
                                }}
                            >
                                <div
                                    style={{
                                        marginBottom: 'var(--spacing-xs)',
                                        color: 'var(--infection-blue)',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    ⏰ Time Range Summary
                                </div>

                                <div style={{ fontSize: '9px' }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            marginBottom: '2px',
                                        }}
                                    >
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            Last 5min:
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            {
                                                analytics.timeRangeMetrics
                                                    .last5min.stimulations
                                            }
                                            s |
                                            {
                                                analytics.timeRangeMetrics
                                                    .last5min.responses
                                            }
                                            r |
                                            {
                                                analytics.timeRangeMetrics
                                                    .last5min.errors
                                            }
                                            e
                                        </span>
                                    </div>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            marginBottom: '2px',
                                        }}
                                    >
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            Last hour:
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            {
                                                analytics.timeRangeMetrics
                                                    .last1hour.stimulations
                                            }
                                            s |
                                            {
                                                analytics.timeRangeMetrics
                                                    .last1hour.responses
                                            }
                                            r |
                                            {
                                                analytics.timeRangeMetrics
                                                    .last1hour.errors
                                            }
                                            e
                                        </span>
                                    </div>
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                        }}
                                    >
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            Last 24h:
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            {
                                                analytics.timeRangeMetrics
                                                    .last24hours.stimulations
                                            }
                                            s |
                                            {
                                                analytics.timeRangeMetrics
                                                    .last24hours.responses
                                            }
                                            r |
                                            {
                                                analytics.timeRangeMetrics
                                                    .last24hours.errors
                                            }
                                            e
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
