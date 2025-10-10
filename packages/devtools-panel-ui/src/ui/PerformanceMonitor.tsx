import React, { useState, useEffect, useRef } from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

interface PerformanceMetrics {
    memoryUsage: {
        used: number;
        total: number;
        percentage: number;
    };
    renderTime: number;
    timestamp: number;
    cnsMetrics: {
        stimulationsPerSecond: number;
        avgResponseTime: number;
        avgHopCount: number;
        activeNeurons: number;
        totalConnections: number;
        queueUtilization: number;
        errorRate: number;
    };
}

interface PerformanceHistory {
    memory: number[];
    timestamps: number[];
    stimulationsPerSecond: number[];
    responseTime: number[];
    hopCount: number[];
    errorRate: number[];
}

export const PerformanceMonitor: React.FC = () => {
    const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
    const [history, setHistory] = useState<PerformanceHistory>({
        memory: [],
        timestamps: [],
        stimulationsPerSecond: [],
        responseTime: [],
        hopCount: [],
        errorRate: [],
    });
    const [isExpanded, setIsExpanded] = useState(false);
    const [lastMetricsTime, setLastMetricsTime] = useState(Date.now());
    const [lastStimulationCount, setLastStimulationCount] = useState(0);

    // Hook into CNStra data
    const allResponses = db.responses.getAll();
    const allStimulations = db.stimulations.getAll();
    const allNeurons = db.neurons.getAll();
    const allDendrites = db.dendrites.getAll();

    // Calculate CNStra-specific metrics
    const getCNSMetrics = () => {
        const now = Date.now();
        const timeDiff = (now - lastMetricsTime) / 1000; // seconds

        // Calculate stimulations per second
        const currentStimulationCount = allStimulations.length;
        const newStimulations = currentStimulationCount - lastStimulationCount;
        const stimulationsPerSecond =
            timeDiff > 0 ? newStimulations / timeDiff : 0;

        // Calculate average response time
        const recentResponses = allResponses.filter(
            r => r.duration && r.duration > 0
        );
        const avgResponseTime =
            recentResponses.length > 0
                ? recentResponses.reduce(
                      (sum, r) => sum + (r.duration || 0),
                      0
                  ) / recentResponses.length
                : 0;

        // Calculate average hop count (not available in StimulationResponse DTO)
        const avgHopCount = 0;

        // Count active neurons (neurons with recent stimulations)
        const recentTime = now - 5000; // last 5 seconds
        const recentStimulations = allStimulations.filter(
            s => s.timestamp > recentTime
        );
        const activeNeuronIds = new Set(
            recentStimulations.map(s => s.neuronId)
        );
        const activeNeurons = activeNeuronIds.size;

        // Count total connections (unique collateral -> dendrite pairs)
        const totalConnections = allDendrites.length;

        // Calculate queue utilization (not available in StimulationResponse DTO)
        const queueUtilization = 0;

        // Calculate error rate
        const responsesWithErrors = allResponses.filter(r => r.error);
        const errorRate =
            allResponses.length > 0
                ? (responsesWithErrors.length / allResponses.length) * 100
                : 0;

        return {
            stimulationsPerSecond:
                Math.round(stimulationsPerSecond * 100) / 100,
            avgResponseTime: Math.round(avgResponseTime * 100) / 100,
            avgHopCount: Math.round(avgHopCount * 100) / 100,
            activeNeurons,
            totalConnections,
            queueUtilization: Math.round(queueUtilization * 100) / 100,
            errorRate: Math.round(errorRate * 100) / 100,
        };
    };

    // Calculate memory usage
    const getMemoryUsage = (): PerformanceMetrics['memoryUsage'] => {
        if ('memory' in performance) {
            const memory = (performance as any).memory;
            const used = memory.usedJSHeapSize;
            const total = memory.totalJSHeapSize;
            return {
                used: Math.round((used / 1024 / 1024) * 100) / 100, // MB
                total: Math.round((total / 1024 / 1024) * 100) / 100, // MB
                percentage: Math.round((used / total) * 100),
            };
        }
        return { used: 0, total: 0, percentage: 0 };
    };

    // Update metrics periodically
    useEffect(() => {
        const updateMetrics = () => {
            const startTime = performance.now();

            const memoryUsage = getMemoryUsage();
            const cnsMetrics = getCNSMetrics();
            const renderTime = performance.now() - startTime;

            const newMetrics: PerformanceMetrics = {
                memoryUsage,
                renderTime,
                timestamp: Date.now(),
                cnsMetrics,
            };

            setMetrics(newMetrics);

            // Update tracking variables
            setLastMetricsTime(Date.now());
            setLastStimulationCount(allStimulations.length);

            // Update history (keep last 60 data points)
            setHistory(prev => {
                const maxPoints = 60;
                const newHistory = {
                    memory: [...prev.memory, memoryUsage.percentage].slice(
                        -maxPoints
                    ),
                    timestamps: [
                        ...prev.timestamps,
                        newMetrics.timestamp,
                    ].slice(-maxPoints),
                    stimulationsPerSecond: [
                        ...prev.stimulationsPerSecond,
                        cnsMetrics.stimulationsPerSecond,
                    ].slice(-maxPoints),
                    responseTime: [
                        ...prev.responseTime,
                        cnsMetrics.avgResponseTime,
                    ].slice(-maxPoints),
                    hopCount: [...prev.hopCount, cnsMetrics.avgHopCount].slice(
                        -maxPoints
                    ),
                    errorRate: [...prev.errorRate, cnsMetrics.errorRate].slice(
                        -maxPoints
                    ),
                };
                return newHistory;
            });
        };

        const interval = setInterval(updateMetrics, 1000); // Update every second
        updateMetrics(); // Initial update

        return () => clearInterval(interval);
    }, []);

    if (!metrics) return null;

    const getStatusColor = (
        value: number,
        thresholds: { warning: number; danger: number }
    ) => {
        if (value >= thresholds.danger) return 'var(--infection-red)';
        if (value >= thresholds.warning) return 'var(--infection-yellow)';
        return 'var(--infection-green)';
    };

    const memoryColor = getStatusColor(metrics.memoryUsage.percentage, {
        warning: 70,
        danger: 90,
    });

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
                transition: 'all var(--transition-medium)',
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
                <span style={{ color: 'var(--infection-green)' }}>
                    📊 Performance
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
                    <div style={{ color: memoryColor }}>
                        🧠 {metrics.memoryUsage.percentage}%
                    </div>
                    <div style={{ color: 'var(--infection-green)' }}>
                        ⚡ {metrics.cnsMetrics.stimulationsPerSecond}/s
                    </div>
                    <div style={{ color: 'var(--infection-blue)' }}>
                        🎯 {metrics.cnsMetrics.activeNeurons}n
                    </div>
                    {/* server metrics compact: show latest CPU if present */}
                    {(() => {
                        const latest = db.serverMetrics
                            .getAll()
                            .slice(-1)[0] as any;
                        return latest ? (
                            <div
                                style={{
                                    color:
                                        latest.cpuPercent > 70
                                            ? 'var(--infection-red)'
                                            : 'var(--infection-green)',
                                }}
                            >
                                🖥️ {latest.cpuPercent}% CPU
                            </div>
                        ) : null;
                    })()}
                    {metrics.cnsMetrics.errorRate > 0 && (
                        <div style={{ color: 'var(--infection-red)' }}>
                            ❌ {metrics.cnsMetrics.errorRate}%
                        </div>
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
                    {/* Memory Usage */}
                    <div>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: 'var(--spacing-xs)',
                            }}
                        >
                            <span>🧠 Memory</span>
                            <span style={{ color: memoryColor }}>
                                {metrics.memoryUsage.used}MB /{' '}
                                {metrics.memoryUsage.total}MB
                            </span>
                        </div>
                        <div
                            style={{
                                width: '100%',
                                height: '4px',
                                background: 'var(--bg-secondary)',
                                borderRadius: '2px',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                style={{
                                    width: `${metrics.memoryUsage.percentage}%`,
                                    height: '100%',
                                    background: memoryColor,
                                    transition: 'width 0.3s ease',
                                }}
                            />
                        </div>
                        <div
                            style={{
                                textAlign: 'center',
                                color: 'var(--text-muted)',
                                marginTop: '2px',
                            }}
                        >
                            {metrics.memoryUsage.percentage}%
                        </div>
                    </div>

                    {/* CNStra Network Metrics */}
                    <div
                        style={{
                            borderTop: '1px solid var(--border-infected)',
                            paddingTop: 'var(--spacing-sm)',
                        }}
                    >
                        <div
                            style={{
                                marginBottom: 'var(--spacing-sm)',
                                color: 'var(--infection-green)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                            }}
                        >
                            🧠 CNStra Metrics
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
                                <span style={{ color: 'var(--text-muted)' }}>
                                    ⚡ Stimulations/s:
                                </span>
                                <br />
                                <span
                                    style={{ color: 'var(--infection-green)' }}
                                >
                                    {metrics.cnsMetrics.stimulationsPerSecond}
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    🎯 Active Neurons:
                                </span>
                                <br />
                                <span
                                    style={{ color: 'var(--infection-blue)' }}
                                >
                                    {metrics.cnsMetrics.activeNeurons}
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    ⏱️ Avg Response:
                                </span>
                                <br />
                                <span
                                    style={{
                                        color:
                                            metrics.cnsMetrics.avgResponseTime >
                                            100
                                                ? 'var(--infection-red)'
                                                : 'var(--infection-green)',
                                    }}
                                >
                                    {metrics.cnsMetrics.avgResponseTime}ms
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    🔗 Connections:
                                </span>
                                <br />
                                <span style={{ color: 'var(--text-primary)' }}>
                                    {metrics.cnsMetrics.totalConnections}
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    🎭 Avg Hops:
                                </span>
                                <br />
                                <span
                                    style={{
                                        color:
                                            metrics.cnsMetrics.avgHopCount > 3
                                                ? 'var(--infection-yellow)'
                                                : 'var(--infection-green)',
                                    }}
                                >
                                    {metrics.cnsMetrics.avgHopCount}
                                </span>
                            </div>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    📊 Queue Util:
                                </span>
                                <br />
                                <span
                                    style={{
                                        color:
                                            metrics.cnsMetrics
                                                .queueUtilization > 10
                                                ? 'var(--infection-red)'
                                                : 'var(--infection-green)',
                                    }}
                                >
                                    {metrics.cnsMetrics.queueUtilization}
                                </span>
                            </div>
                        </div>

                        {metrics.cnsMetrics.errorRate > 0 && (
                            <div
                                style={{
                                    marginTop: 'var(--spacing-xs)',
                                    padding: 'var(--spacing-xs)',
                                    background: 'var(--infection-red)',
                                    borderRadius: '2px',
                                    fontSize: '10px',
                                    color: 'white',
                                }}
                            >
                                ❌ Error Rate: {metrics.cnsMetrics.errorRate}%
                            </div>
                        )}
                    </div>

                    {/* Mini charts for CNStra trends */}
                    {history.stimulationsPerSecond.length > 1 && (
                        <div>
                            <div
                                style={{
                                    marginBottom: 'var(--spacing-xs)',
                                    color: 'var(--text-muted)',
                                    fontSize: '10px',
                                }}
                            >
                                📈 Stimulations Trend (last{' '}
                                {history.stimulationsPerSecond.length}s)
                            </div>
                            <div
                                style={{
                                    height: '15px',
                                    background: 'var(--bg-secondary)',
                                    borderRadius: '2px',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                            >
                                <svg
                                    width="100%"
                                    height="100%"
                                    style={{ position: 'absolute' }}
                                >
                                    <polyline
                                        fill="none"
                                        stroke="var(--infection-green)"
                                        strokeWidth="1"
                                        points={history.stimulationsPerSecond
                                            .map((value, index) => {
                                                const maxValue = Math.max(
                                                    ...history.stimulationsPerSecond,
                                                    1
                                                );
                                                return `${
                                                    (index /
                                                        (history
                                                            .stimulationsPerSecond
                                                            .length -
                                                            1)) *
                                                    100
                                                },${
                                                    15 - (value / maxValue) * 15
                                                }`;
                                            })
                                            .join(' ')}
                                    />
                                </svg>
                            </div>
                        </div>
                    )}

                    {/* Mini chart for memory trend */}
                    {history.memory.length > 1 && (
                        <div>
                            <div
                                style={{
                                    marginBottom: 'var(--spacing-xs)',
                                    color: 'var(--text-muted)',
                                    fontSize: '10px',
                                }}
                            >
                                📈 Memory Trend (last {history.memory.length}s)
                            </div>
                            <div
                                style={{
                                    height: '15px',
                                    background: 'var(--bg-secondary)',
                                    borderRadius: '2px',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                            >
                                <svg
                                    width="100%"
                                    height="100%"
                                    style={{ position: 'absolute' }}
                                >
                                    <polyline
                                        fill="none"
                                        stroke={memoryColor}
                                        strokeWidth="1"
                                        points={history.memory
                                            .map(
                                                (value, index) =>
                                                    `${
                                                        (index /
                                                            (history.memory
                                                                .length -
                                                                1)) *
                                                        100
                                                    },${
                                                        15 - (value / 100) * 15
                                                    }`
                                            )
                                            .join(' ')}
                                    />
                                </svg>
                            </div>
                        </div>
                    )}

                    {/* Server metrics timeline */}
                    <div
                        style={{
                            borderTop: '1px solid var(--border-infected)',
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
                            🖥️ Server Metrics (last 30s)
                        </div>
                        {(() => {
                            const points = db.serverMetrics
                                .getAll()
                                .slice(-30) as any[];
                            if (points.length === 0)
                                return (
                                    <div
                                        style={{
                                            color: 'var(--text-muted)',
                                            fontSize: '10px',
                                        }}
                                    >
                                        No server metrics
                                    </div>
                                );
                            const cpuMax = Math.max(
                                ...points.map(p => p.cpuPercent),
                                1
                            );
                            const memMax = Math.max(
                                ...points.map(p => p.heapUsedMB),
                                1
                            );
                            return (
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    <div
                                        style={{
                                            fontSize: '10px',
                                            color: 'var(--text-muted)',
                                        }}
                                    >
                                        CPU%
                                    </div>
                                    <div
                                        style={{
                                            height: '20px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '2px',
                                            position: 'relative',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <svg
                                            width="100%"
                                            height="100%"
                                            style={{ position: 'absolute' }}
                                        >
                                            <polyline
                                                fill="none"
                                                stroke="var(--infection-green)"
                                                strokeWidth="1"
                                                points={points
                                                    .map(
                                                        (p, i) =>
                                                            `${
                                                                (i /
                                                                    (points.length -
                                                                        1)) *
                                                                100
                                                            },${
                                                                20 -
                                                                (p.cpuPercent /
                                                                    Math.max(
                                                                        cpuMax,
                                                                        100
                                                                    )) *
                                                                    20
                                                            }`
                                                    )
                                                    .join(' ')}
                                            />
                                        </svg>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: '10px',
                                            color: 'var(--text-muted)',
                                        }}
                                    >
                                        Heap Used (MB)
                                    </div>
                                    <div
                                        style={{
                                            height: '20px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '2px',
                                            position: 'relative',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <svg
                                            width="100%"
                                            height="100%"
                                            style={{ position: 'absolute' }}
                                        >
                                            <polyline
                                                fill="none"
                                                stroke="var(--infection-blue)"
                                                strokeWidth="1"
                                                points={points
                                                    .map(
                                                        (p, i) =>
                                                            `${
                                                                (i /
                                                                    (points.length -
                                                                        1)) *
                                                                100
                                                            },${
                                                                20 -
                                                                (p.heapUsedMB /
                                                                    memMax) *
                                                                    20
                                                            }`
                                                    )
                                                    .join(' ')}
                                            />
                                        </svg>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Additional info */}
                    <div
                        style={{
                            borderTop: '1px solid var(--border-primary)',
                            paddingTop: 'var(--spacing-xs)',
                            fontSize: '10px',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            justifyContent: 'space-between',
                        }}
                    >
                        <span>
                            🕒 Render: {metrics.renderTime.toFixed(2)}ms
                        </span>
                        <span>📊 DevTools UI</span>
                    </div>
                </div>
            )}
        </div>
    );
};
