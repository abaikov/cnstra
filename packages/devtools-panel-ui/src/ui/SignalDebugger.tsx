import React, { useState, useRef } from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

interface SignalInjectionPayload {
    collateralName: string;
    payload: string; // JSON string
    contexts: string; // JSON string
    options: string; // JSON string
}

interface Props {
    wsRef: React.RefObject<WebSocket | null>;
    selectedAppId: string | null;
    selectedCnsId?: string;
}

export const SignalDebugger: React.FC<Props> = ({
    wsRef,
    selectedAppId,
    selectedCnsId,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [injectionData, setInjectionData] = useState<SignalInjectionPayload>({
        collateralName: '',
        payload: '{}',
        contexts: '{}',
        options: '{}',
    });
    const [injectionHistory, setInjectionHistory] = useState<
        Array<{
            timestamp: number;
            collateralName: string;
            payload: unknown;
            success: boolean;
            error?: string;
        }>
    >([]);
    const [selectedCollateral, setSelectedCollateral] = useState<string>('');

    // Get all collaterals for the selected app
    const allCollaterals = useSelectEntitiesByIndexKey(
        db.collaterals,
        db.collaterals.indexes.appId,
        selectedAppId || 'dummy-id'
    );

    // Get recent stimulations for inspection
    const recentStimulations =
        useSelectEntitiesByIndexKey(
            db.stimulations,
            db.stimulations.indexes.appId,
            selectedAppId || 'dummy-id'
        )
            ?.slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 10) || [];

    const handleInjectSignal = () => {
        if (!wsRef.current || !selectedAppId || !injectionData.collateralName) {
            const error =
                'Missing WebSocket connection, app selection, or collateral name';
            setInjectionHistory(prev => [
                {
                    timestamp: Date.now(),
                    collateralName: injectionData.collateralName,
                    payload: injectionData.payload,
                    success: false,
                    error,
                },
                ...prev.slice(0, 19), // Keep last 20 items
            ]);
            return;
        }

        try {
            const payload = injectionData.payload
                ? JSON.parse(injectionData.payload)
                : undefined;
            const contexts = injectionData.contexts
                ? JSON.parse(injectionData.contexts)
                : undefined;
            const options = injectionData.options
                ? JSON.parse(injectionData.options)
                : undefined;

            // Determine CNS target if uniquely identified for the selected app
            const cnsIds = (db.cns.indexes.appId.getPksByKey(selectedAppId) ||
                new Set()) as Set<string>;
            const singleCnsId =
                selectedCnsId ||
                (cnsIds.size === 1 ? Array.from(cnsIds)[0] : undefined);

            const stimulateCommand = {
                type: 'stimulate',
                stimulationCommandId: `debug-${Date.now()}`,
                collateralName: injectionData.collateralName,
                payload,
                contexts,
                options,
                appId: selectedAppId,
                ...(singleCnsId ? { cnsId: singleCnsId } : {}),
            };

            wsRef.current.send(JSON.stringify(stimulateCommand));

            setInjectionHistory(prev => [
                {
                    timestamp: Date.now(),
                    collateralName: injectionData.collateralName,
                    payload,
                    success: true,
                },
                ...prev.slice(0, 19),
            ]);

            console.log('🔧 Signal injected:', stimulateCommand);
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';
            setInjectionHistory(prev => [
                {
                    timestamp: Date.now(),
                    collateralName: injectionData.collateralName,
                    payload: injectionData.payload,
                    success: false,
                    error: errorMessage,
                },
                ...prev.slice(0, 19),
            ]);
        }
    };

    const handleCopyStimulation = (stimulation: any) => {
        setInjectionData({
            collateralName: stimulation.collateralName,
            payload: JSON.stringify(stimulation.payload || {}, null, 2),
            contexts: JSON.stringify(stimulation.contexts || {}, null, 2),
            options: '{}',
        });
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
                🔧 Select an app to access debugging tools
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
                <span style={{ color: 'var(--infection-red)' }}>
                    🔧 Signal Debugger
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                    {isExpanded ? '▼' : '▶'}
                </span>
            </div>

            {!isExpanded ? (
                // Compact view
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Click to expand debugging tools
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
                    {/* Signal Injection Section */}
                    <div>
                        <div
                            style={{
                                marginBottom: 'var(--spacing-xs)',
                                color: 'var(--infection-red)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                            }}
                        >
                            💉 Signal Injection
                        </div>

                        {/* Collateral Selection */}
                        <div style={{ marginBottom: 'var(--spacing-xs)' }}>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '2px',
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                }}
                            >
                                Target Collateral:
                            </label>
                            <select
                                value={injectionData.collateralName}
                                onChange={e =>
                                    setInjectionData(prev => ({
                                        ...prev,
                                        collateralName: e.target.value,
                                    }))
                                }
                                style={{
                                    width: '100%',
                                    padding: '4px',
                                    fontSize: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: '2px',
                                    color: 'var(--text-primary)',
                                }}
                            >
                                <option value="">Select collateral...</option>
                                {allCollaterals?.map(col => (
                                    <option
                                        key={col.collateralName}
                                        value={col.collateralName}
                                    >
                                        {col.collateralName} ({col.type})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Payload Input */}
                        <div style={{ marginBottom: 'var(--spacing-xs)' }}>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '2px',
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                }}
                            >
                                Payload (JSON):
                            </label>
                            <textarea
                                value={injectionData.payload}
                                onChange={e =>
                                    setInjectionData(prev => ({
                                        ...prev,
                                        payload: e.target.value,
                                    }))
                                }
                                style={{
                                    width: '100%',
                                    height: '40px',
                                    padding: '4px',
                                    fontSize: '10px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: '2px',
                                    color: 'var(--text-primary)',
                                    resize: 'vertical',
                                    fontFamily: 'monospace',
                                }}
                                placeholder='{"key": "value"}'
                            />
                        </div>

                        {/* Advanced Options */}
                        <details style={{ marginBottom: 'var(--spacing-xs)' }}>
                            <summary
                                style={{
                                    cursor: 'pointer',
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                }}
                            >
                                Advanced Options
                            </summary>
                            <div style={{ marginTop: 'var(--spacing-xs)' }}>
                                <label
                                    style={{
                                        display: 'block',
                                        marginBottom: '2px',
                                        fontSize: '10px',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    Contexts (JSON):
                                </label>
                                <textarea
                                    value={injectionData.contexts}
                                    onChange={e =>
                                        setInjectionData(prev => ({
                                            ...prev,
                                            contexts: e.target.value,
                                        }))
                                    }
                                    style={{
                                        width: '100%',
                                        height: '30px',
                                        padding: '4px',
                                        fontSize: '10px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)',
                                        borderRadius: '2px',
                                        color: 'var(--text-primary)',
                                        fontFamily: 'monospace',
                                        marginBottom: 'var(--spacing-xs)',
                                    }}
                                />
                                <label
                                    style={{
                                        display: 'block',
                                        marginBottom: '2px',
                                        fontSize: '10px',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    Options (JSON):
                                </label>
                                <textarea
                                    value={injectionData.options}
                                    onChange={e =>
                                        setInjectionData(prev => ({
                                            ...prev,
                                            options: e.target.value,
                                        }))
                                    }
                                    style={{
                                        width: '100%',
                                        height: '30px',
                                        padding: '4px',
                                        fontSize: '10px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-primary)',
                                        borderRadius: '2px',
                                        color: 'var(--text-primary)',
                                        fontFamily: 'monospace',
                                    }}
                                />
                            </div>
                        </details>

                        {/* Inject Button */}
                        <button
                            onClick={handleInjectSignal}
                            disabled={!injectionData.collateralName}
                            className="btn-infected"
                            style={{
                                width: '100%',
                                padding: 'var(--spacing-sm)',
                                fontSize: '11px',
                                background: injectionData.collateralName
                                    ? 'var(--infection-red)'
                                    : 'var(--bg-secondary)',
                                color: injectionData.collateralName
                                    ? 'white'
                                    : 'var(--text-muted)',
                                border: `1px solid ${
                                    injectionData.collateralName
                                        ? 'var(--infection-red)'
                                        : 'var(--border-primary)'
                                }`,
                                borderRadius: '2px',
                                cursor: injectionData.collateralName
                                    ? 'pointer'
                                    : 'not-allowed',
                            }}
                        >
                            💉 Inject Signal
                        </button>
                    </div>

                    {/* Recent Stimulations for Inspection */}
                    <div
                        style={{
                            borderTop: '1px solid var(--border-primary)',
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
                            🔍 Recent Stimulations
                        </div>

                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                            {recentStimulations.length > 0 ? (
                                recentStimulations.map((stim, index) => (
                                    <div
                                        key={stim.stimulationId}
                                        style={{
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-primary)',
                                            borderRadius: '2px',
                                            padding: '4px',
                                            marginBottom: '4px',
                                            fontSize: '9px',
                                        }}
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
                                                {stim.collateralName}
                                            </span>
                                            <button
                                                onClick={() =>
                                                    handleCopyStimulation(stim)
                                                }
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'var(--text-muted)',
                                                    cursor: 'pointer',
                                                    fontSize: '8px',
                                                    padding: '2px',
                                                }}
                                                title="Copy to injection form"
                                            >
                                                📋 Copy
                                            </button>
                                        </div>
                                        <div
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            {new Date(
                                                stim.timestamp
                                            ).toLocaleTimeString()}{' '}
                                            | from: {stim.neuronId} | payload:{' '}
                                            {JSON.stringify(
                                                stim.payload
                                            ).substring(0, 30)}
                                            ...
                                        </div>
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
                                    No recent stimulations found
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Injection History */}
                    {injectionHistory.length > 0 && (
                        <div
                            style={{
                                borderTop: '1px solid var(--border-primary)',
                                paddingTop: 'var(--spacing-sm)',
                            }}
                        >
                            <div
                                style={{
                                    marginBottom: 'var(--spacing-xs)',
                                    color: 'var(--infection-yellow)',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                }}
                            >
                                📊 Injection History
                            </div>

                            <div
                                style={{ maxHeight: '80px', overflowY: 'auto' }}
                            >
                                {injectionHistory.map((injection, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            background: injection.success
                                                ? 'var(--bg-secondary)'
                                                : 'rgba(255, 0, 0, 0.1)',
                                            border: `1px solid ${
                                                injection.success
                                                    ? 'var(--border-primary)'
                                                    : 'var(--infection-red)'
                                            }`,
                                            borderRadius: '2px',
                                            padding: '4px',
                                            marginBottom: '2px',
                                            fontSize: '9px',
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: injection.success
                                                        ? 'var(--infection-green)'
                                                        : 'var(--infection-red)',
                                                }}
                                            >
                                                {injection.success
                                                    ? '✅'
                                                    : '❌'}{' '}
                                                {injection.collateralName}
                                            </span>
                                            <span
                                                style={{
                                                    color: 'var(--text-muted)',
                                                }}
                                            >
                                                {new Date(
                                                    injection.timestamp
                                                ).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        {injection.error && (
                                            <div
                                                style={{
                                                    color: 'var(--infection-red)',
                                                    fontSize: '8px',
                                                }}
                                            >
                                                Error: {injection.error}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
