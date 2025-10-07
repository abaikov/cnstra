import React, { useState, useMemo } from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

interface Props {
    selectedAppId: string | null;
}

interface StimulationFlow {
    stimulationId: string;
    timestamp: number;
    neuronId: string;
    collateralName: string;
    payload?: unknown;
    contexts?: Record<string, unknown>;
    hops?: number;
    responses: Array<{
        responseId: string;
        neuronId: string;
        timestamp: number;
        duration?: number;
        error?: string;
        hops?: number;
    }>;
}

export const ContextStoreMonitor: React.FC<Props> = ({ selectedAppId }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
    const [showOnlyWithContexts, setShowOnlyWithContexts] = useState(false);

    // Get stimulations and responses for the selected app
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

    // Build stimulation flows with context tracking
    const stimulationFlows = useMemo((): StimulationFlow[] => {
        if (!allStimulations || !allResponses) return [];

        const flows = allStimulations.map(stim => {
            const responses = allResponses
                .filter(resp => resp.stimulationId === stim.stimulationId)
                .map(resp => ({
                    responseId: resp.responseId,
                    neuronId: resp.neuronId ?? '(unknown)',
                    timestamp: resp.timestamp,
                    duration: resp.duration,
                    error: resp.error,
                    hops: undefined, // hops not available in StimulationResponse DTO
                }))
                .sort((a, b) => a.timestamp - b.timestamp);

            return {
                stimulationId: stim.stimulationId,
                timestamp: stim.timestamp,
                neuronId: stim.neuronId,
                collateralName: stim.collateralName,
                payload: stim.payload,
                contexts: stim.contexts,
                hops:
                    responses.length > 0
                        ? responses[responses.length - 1].hops
                        : undefined,
                responses,
            };
        });

        // Filter flows if needed
        const filteredFlows = showOnlyWithContexts
            ? flows.filter(
                  flow => flow.contexts && Object.keys(flow.contexts).length > 0
              )
            : flows;

        // Sort by timestamp descending
        return filteredFlows.sort((a, b) => b.timestamp - a.timestamp);
    }, [allStimulations, allResponses, showOnlyWithContexts]);

    // Calculate context statistics
    const contextStats = useMemo(() => {
        if (!stimulationFlows.length) return null;

        const contextKeys = new Set<string>();
        const contextValues = new Map<string, Set<unknown>>();
        let flowsWithContexts = 0;
        let totalHops = 0;
        let hopCounts = 0;

        stimulationFlows.forEach(flow => {
            if (flow.contexts) {
                flowsWithContexts++;
                Object.entries(flow.contexts).forEach(([key, value]) => {
                    contextKeys.add(key);
                    if (!contextValues.has(key)) {
                        contextValues.set(key, new Set());
                    }
                    contextValues.get(key)!.add(value);
                });
            }

            if (flow.hops !== undefined) {
                totalHops += flow.hops;
                hopCounts++;
            }
        });

        return {
            totalFlows: stimulationFlows.length,
            flowsWithContexts,
            contextKeysCount: contextKeys.size,
            avgHops: hopCounts > 0 ? (totalHops / hopCounts).toFixed(2) : '0',
            mostCommonContextKeys: Array.from(contextKeys).slice(0, 5),
            contextUtilization: (
                (flowsWithContexts / stimulationFlows.length) *
                100
            ).toFixed(1),
        };
    }, [stimulationFlows]);

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
                🧮 Select an app to monitor context store
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
                <span style={{ color: 'var(--infection-blue)' }}>
                    🧮 Context Store Monitor
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
                    {contextStats && (
                        <>
                            <div style={{ color: 'var(--infection-blue)' }}>
                                🔄 {contextStats.totalFlows} flows
                            </div>
                            <div style={{ color: 'var(--infection-green)' }}>
                                📊 {contextStats.contextUtilization}% with
                                contexts
                            </div>
                            <div style={{ color: 'var(--infection-yellow)' }}>
                                🎭 {contextStats.avgHops} avg hops
                            </div>
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
                    {/* Context Statistics */}
                    {contextStats && (
                        <div>
                            <div
                                style={{
                                    marginBottom: 'var(--spacing-xs)',
                                    color: 'var(--infection-blue)',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                }}
                            >
                                📊 Context Statistics
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
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        🔄 Total Flows:
                                    </span>
                                    <br />
                                    <span
                                        style={{
                                            color: 'var(--infection-blue)',
                                        }}
                                    >
                                        {contextStats.totalFlows}
                                    </span>
                                </div>
                                <div>
                                    <span
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        📊 With Contexts:
                                    </span>
                                    <br />
                                    <span
                                        style={{
                                            color: 'var(--infection-green)',
                                        }}
                                    >
                                        {contextStats.flowsWithContexts} (
                                        {contextStats.contextUtilization}%)
                                    </span>
                                </div>
                                <div>
                                    <span
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        🗂️ Context Keys:
                                    </span>
                                    <br />
                                    <span
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {contextStats.contextKeysCount}
                                    </span>
                                </div>
                                <div>
                                    <span
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        🎭 Avg Hops:
                                    </span>
                                    <br />
                                    <span
                                        style={{
                                            color: 'var(--infection-yellow)',
                                        }}
                                    >
                                        {contextStats.avgHops}
                                    </span>
                                </div>
                            </div>

                            {contextStats.mostCommonContextKeys.length > 0 && (
                                <div style={{ marginTop: 'var(--spacing-xs)' }}>
                                    <div
                                        style={{
                                            color: 'var(--text-muted)',
                                            fontSize: '10px',
                                            marginBottom: '2px',
                                        }}
                                    >
                                        📋 Common Context Keys:
                                    </div>
                                    <div
                                        style={{
                                            fontSize: '9px',
                                            color: 'var(--infection-green)',
                                        }}
                                    >
                                        {contextStats.mostCommonContextKeys.join(
                                            ', '
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Flow Filter */}
                    <div
                        style={{
                            borderTop: '1px solid var(--border-primary)',
                            paddingTop: 'var(--spacing-sm)',
                        }}
                    >
                        <label
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-xs)',
                                fontSize: '10px',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={showOnlyWithContexts}
                                onChange={e =>
                                    setShowOnlyWithContexts(e.target.checked)
                                }
                                style={{ margin: 0 }}
                            />
                            Show only flows with contexts
                        </label>
                    </div>

                    {/* Stimulation Flows */}
                    <div>
                        <div
                            style={{
                                marginBottom: 'var(--spacing-xs)',
                                color: 'var(--infection-blue)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                            }}
                        >
                            🔄 Stimulation Flows ({stimulationFlows.length})
                        </div>

                        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {stimulationFlows.length > 0 ? (
                                stimulationFlows.slice(0, 20).map(flow => (
                                    <div
                                        key={flow.stimulationId}
                                        style={{
                                            background:
                                                selectedFlow ===
                                                flow.stimulationId
                                                    ? 'var(--flesh-infected)'
                                                    : 'var(--bg-secondary)',
                                            border: `1px solid ${
                                                selectedFlow ===
                                                flow.stimulationId
                                                    ? 'var(--border-infected)'
                                                    : 'var(--border-primary)'
                                            }`,
                                            borderRadius: '2px',
                                            padding: '6px',
                                            marginBottom: '4px',
                                            fontSize: '9px',
                                            cursor: 'pointer',
                                        }}
                                        onClick={() =>
                                            setSelectedFlow(
                                                selectedFlow ===
                                                    flow.stimulationId
                                                    ? null
                                                    : flow.stimulationId
                                            )
                                        }
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                marginBottom: '2px',
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: 'var(--infection-green)',
                                                }}
                                            >
                                                🎯 {flow.collateralName}
                                            </span>
                                            <span
                                                style={{
                                                    color: 'var(--text-muted)',
                                                }}
                                            >
                                                {new Date(
                                                    flow.timestamp
                                                ).toLocaleTimeString()}
                                            </span>
                                        </div>

                                        <div
                                            style={{
                                                color: 'var(--text-muted)',
                                                marginBottom: '2px',
                                            }}
                                        >
                                            from: {flow.neuronId} | responses:{' '}
                                            {flow.responses.length} | hops:{' '}
                                            {flow.hops || 0}
                                        </div>

                                        {flow.contexts &&
                                            Object.keys(flow.contexts).length >
                                                0 && (
                                                <div
                                                    style={{
                                                        background:
                                                            'var(--bg-card)',
                                                        border: '1px solid var(--border-accent)',
                                                        borderRadius: '2px',
                                                        padding: '3px',
                                                        marginTop: '3px',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            color: 'var(--infection-blue)',
                                                            marginBottom: '1px',
                                                        }}
                                                    >
                                                        🧮 Contexts (
                                                        {
                                                            Object.keys(
                                                                flow.contexts
                                                            ).length
                                                        }
                                                        ):
                                                    </div>
                                                    <div
                                                        style={{
                                                            color: 'var(--text-secondary)',
                                                            fontFamily:
                                                                'monospace',
                                                            fontSize: '8px',
                                                        }}
                                                    >
                                                        {JSON.stringify(
                                                            flow.contexts,
                                                            null,
                                                            1
                                                        ).substring(0, 100)}
                                                        {JSON.stringify(
                                                            flow.contexts
                                                        ).length > 100 && '...'}
                                                    </div>
                                                </div>
                                            )}

                                        {selectedFlow ===
                                            flow.stimulationId && (
                                            <div
                                                style={{
                                                    marginTop: '4px',
                                                    paddingTop: '4px',
                                                    borderTop:
                                                        '1px solid var(--border-primary)',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        color: 'var(--infection-yellow)',
                                                        marginBottom: '2px',
                                                    }}
                                                >
                                                    📋 Response Chain:
                                                </div>
                                                {flow.responses.length > 0 ? (
                                                    flow.responses.map(
                                                        (resp, index) => (
                                                            <div
                                                                key={
                                                                    resp.responseId
                                                                }
                                                                style={{
                                                                    background:
                                                                        'var(--bg-card)',
                                                                    border: '1px solid var(--border-accent)',
                                                                    borderRadius:
                                                                        '2px',
                                                                    padding:
                                                                        '2px 4px',
                                                                    marginBottom:
                                                                        '2px',
                                                                    fontSize:
                                                                        '8px',
                                                                }}
                                                            >
                                                                <span
                                                                    style={{
                                                                        color: resp.error
                                                                            ? 'var(--infection-red)'
                                                                            : 'var(--infection-green)',
                                                                    }}
                                                                >
                                                                    {index + 1}.{' '}
                                                                    {
                                                                        resp.neuronId
                                                                    }
                                                                </span>
                                                                <span
                                                                    style={{
                                                                        color: 'var(--text-muted)',
                                                                        marginLeft:
                                                                            '8px',
                                                                    }}
                                                                >
                                                                    {
                                                                        resp.duration
                                                                    }
                                                                    ms | hop #
                                                                    {resp.hops ||
                                                                        0}
                                                                </span>
                                                                {resp.error && (
                                                                    <div
                                                                        style={{
                                                                            color: 'var(--infection-red)',
                                                                            fontSize:
                                                                                '7px',
                                                                        }}
                                                                    >
                                                                        ❌{' '}
                                                                        {
                                                                            resp.error
                                                                        }
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    )
                                                ) : (
                                                    <div
                                                        style={{
                                                            color: 'var(--text-muted)',
                                                            fontStyle: 'italic',
                                                        }}
                                                    >
                                                        No responses recorded
                                                    </div>
                                                )}

                                                {flow.payload ? (
                                                    <div
                                                        style={{
                                                            marginTop: '3px',
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                color: 'var(--infection-green)',
                                                                marginBottom:
                                                                    '1px',
                                                            }}
                                                        >
                                                            📦 Payload:
                                                        </div>
                                                        <div
                                                            style={{
                                                                background:
                                                                    'var(--bg-card)',
                                                                border: '1px solid var(--border-accent)',
                                                                borderRadius:
                                                                    '2px',
                                                                padding: '3px',
                                                                fontFamily:
                                                                    'monospace',
                                                                fontSize: '7px',
                                                                color: 'var(--text-secondary)',
                                                            }}
                                                        >
                                                            {JSON.stringify(
                                                                flow.payload,
                                                                null,
                                                                1
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : undefined}
                                            </div>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div
                                    style={{
                                        color: 'var(--text-muted)',
                                        fontStyle: 'italic',
                                        textAlign: 'center',
                                    }}
                                >
                                    {showOnlyWithContexts
                                        ? 'No flows with contexts found'
                                        : 'No stimulation flows found'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
