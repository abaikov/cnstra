import React, { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../model';
import type { TApp } from '../model';
import type { ConnectionStatus, DevtoolsSocket } from './hooks/useDevtoolsSocket';
import { PerformanceMonitor } from './PerformanceMonitor';
import { SignalDebugger } from './SignalDebugger';
import { ContextStoreMonitor } from './ContextStoreMonitor';
import { AnalyticsDashboard } from './AnalyticsDashboard';

// Generate an opaque requestId for the request/response query protocol.
const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface SidebarProps {
    connectionStatus: ConnectionStatus;
    connectedApps: TApp[];
    selectedAppId: string | null;
    effectiveSelectedAppId: string | null;
    selectedCnsId: string | null;
    wsRef: DevtoolsSocket['wsRef'];
    send: DevtoolsSocket['send'];
    onSelectApp: (appId: string) => void;
    onSelectCns: (cnsId: string | null) => void;
    onRefresh: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    connectionStatus,
    connectedApps,
    selectedAppId,
    effectiveSelectedAppId,
    selectedCnsId,
    wsRef,
    send,
    onSelectApp,
    onSelectCns,
    onRefresh,
}) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [, setActiveTab] = useState<'topology'>('topology');
    const [onlyErrors, setOnlyErrors] = useState<boolean>(false);

    // CNS list for selected app
    const cnsIdsForApp = useMemo(() => {
        if (!selectedAppId) return [] as string[];
        const pks = (db.cns.indexes.appId.getPksByKey(selectedAppId) ||
            new Set()) as Set<string>;
        return Array.from(pks);
    }, [selectedAppId]);

    return (
        <div
            className="flicker"
            style={{
                width: '325px',
                minWidth: '325px',
                background: 'var(--bg-panel)',
                padding: 'var(--spacing-xl)',
                borderRight: `2px solid var(--border-infected)`,
                overflowY: 'auto',
                boxShadow: 'inset 0 0 10px var(--shadow-blood)',
            }}
        >
            <h2
                style={{
                    margin: `0 0 var(--spacing-md) 0`,
                    color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-xl)',
                }}
            >
                🧠 CNStra DevTools
            </h2>

            {/* Performance Monitor */}
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <PerformanceMonitor />
            </div>

            {/* Signal Debugger */}
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <SignalDebugger
                    wsRef={wsRef}
                    selectedAppId={effectiveSelectedAppId}
                    selectedCnsId={selectedCnsId || undefined}
                />
            </div>

            {/* Context Store Monitor */}
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <ContextStoreMonitor selectedAppId={effectiveSelectedAppId} />
            </div>

            {/* Analytics Dashboard */}
            <div style={{ marginBottom: 'var(--spacing-xl)' }}>
                <AnalyticsDashboard selectedAppId={effectiveSelectedAppId} />
            </div>

            <div style={{ marginBottom: 'var(--spacing-xl)' }}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 'var(--spacing-md)',
                    }}
                >
                    <h3
                        style={{
                            margin: 0,
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                            letterSpacing: '1px',
                        }}
                    >
                        📱 CONNECTED APPS ({connectedApps?.length || 0})
                    </h3>
                    <button
                        onClick={onRefresh}
                        style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-accent)',
                            color: 'var(--text-primary)',
                            padding: 'var(--spacing-xs) var(--spacing-sm)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--font-size-xs)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background =
                                'var(--flesh-infected)';
                            e.currentTarget.style.borderColor =
                                'var(--border-infected)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--bg-card)';
                            e.currentTarget.style.borderColor =
                                'var(--border-accent)';
                        }}
                    >
                        🔄 Refresh
                    </button>
                </div>
                {connectedApps?.length ? (
                    connectedApps.map(app => (
                        <div
                            key={app.id}
                            className={`pulse-infection ${
                                selectedAppId === app.id ? 'decay-glow' : ''
                            }`}
                            onClick={() => onSelectApp(app.id)}
                            style={{
                                background:
                                    selectedAppId === app.id
                                        ? 'var(--flesh-infected)'
                                        : 'var(--bg-card)',
                                padding: 'var(--spacing-md)',
                                borderRadius: 'var(--radius-sm)',
                                marginBottom: 'var(--spacing-sm)',
                                borderLeft: `4px solid ${
                                    selectedAppId === app.id
                                        ? 'var(--infection-green)'
                                        : 'var(--infection-red)'
                                }`,
                                border: `2px solid ${
                                    selectedAppId === app.id
                                        ? 'var(--border-infected)'
                                        : 'var(--border-accent)'
                                }`,
                                boxShadow:
                                    selectedAppId === app.id
                                        ? '0 0 15px var(--shadow-infection)'
                                        : '0 2px 4px var(--shadow-dark)',
                                cursor: 'pointer',
                                transition: 'all var(--transition-medium)',
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 'bold',
                                    marginBottom: 'var(--spacing-xs)',
                                    color: 'var(--text-primary)',
                                    fontSize: 'var(--font-size-base)',
                                }}
                            >
                                🧠 {app.name}
                            </div>
                            <div
                                style={{
                                    fontSize: 'var(--font-size-xs)',
                                    color: 'var(--text-secondary)',
                                    fontFamily: 'var(--font-primary)',
                                }}
                            >
                                {app.id}
                            </div>
                            <div
                                style={{
                                    fontSize: 'var(--font-size-xs)',
                                    color:
                                        selectedAppId === app.id
                                            ? 'var(--infection-green)'
                                            : 'var(--text-success)',
                                    marginTop: 'var(--spacing-xs)',
                                }}
                            >
                                {selectedAppId === app.id
                                    ? '🎯 MONITORING'
                                    : '🟢 CONNECTED'}
                            </div>
                        </div>
                    ))
                ) : (
                    <div
                        style={{
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                            textAlign: 'center',
                            padding: 'var(--spacing-xl)',
                            background: 'var(--bg-card)',
                            borderRadius: 'var(--radius-sm)',
                            border: `1px dashed var(--border-primary)`,
                        }}
                    >
                        📱 No connected applications
                    </div>
                )}
            </div>

            <div>
                <h3
                    style={{
                        margin: `0 0 var(--spacing-md) 0`,
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-muted)',
                        letterSpacing: '1px',
                    }}
                >
                    🔗 CONNECTION STATUS
                </h3>
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color:
                            connectionStatus === 'connected'
                                ? 'var(--text-success)'
                                : connectionStatus === 'connecting'
                                ? 'var(--text-warning)'
                                : 'var(--text-error)',
                        marginBottom: 'var(--spacing-xs)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-xs)',
                    }}
                >
                    <div
                        style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor:
                                connectionStatus === 'connected'
                                    ? 'var(--infection-green)'
                                    : connectionStatus === 'connecting'
                                    ? 'var(--infection-yellow)'
                                    : 'var(--infection-red)',
                        }}
                    />
                    {connectionStatus === 'connected' && '✅ Server Connected'}
                    {connectionStatus === 'connecting' && '🔄 Connecting...'}
                    {connectionStatus === 'disconnected' && '❌ Disconnected'}
                </div>
                {selectedAppId && (
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--infection-green)',
                            marginBottom: 'var(--spacing-lg)',
                            padding: 'var(--spacing-xs)',
                            background: 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-infected)',
                        }}
                    >
                        🎯 Monitoring:{' '}
                        {connectedApps?.find(app => app.id === selectedAppId)
                            ?.name || selectedAppId}
                        {cnsIdsForApp.length > 1 && (
                            <div style={{ marginTop: '6px' }}>
                                <label
                                    style={{
                                        fontSize: '10px',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    CNS Instance:
                                </label>
                                <select
                                    value={selectedCnsId || ''}
                                    onChange={e =>
                                        onSelectCns(e.target.value || null)
                                    }
                                    style={{
                                        marginLeft: '6px',
                                        padding: '2px 4px',
                                        fontSize: '10px',
                                        background: 'var(--bg-panel)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)',
                                    }}
                                >
                                    {cnsIdsForApp.map(id => (
                                        <option key={id} value={id}>
                                            {id}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                )}

                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--spacing-sm)',
                    }}
                >
                    {/* Stimulation filter controls */}
                    <div
                        style={{
                            border: `1px solid var(--border-primary)`,
                            borderRadius: 'var(--radius-sm)',
                            padding: '8px',
                            background: 'var(--bg-card)',
                        }}
                    >
                        <div
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                                marginBottom: 6,
                            }}
                        >
                            Stimulation Filters (optional)
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                            <label
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: '10px',
                                    color: 'var(--text-secondary)',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={onlyErrors}
                                    onChange={e =>
                                        setOnlyErrors(e.target.checked)
                                    }
                                />
                                Only errors
                            </label>
                            <button
                                className="btn-infected"
                                onClick={() => {
                                    if (!selectedAppId) return;
                                    send({
                                        type: 'stimulations.query',
                                        requestId: genRequestId(),
                                        appId: selectedAppId,
                                        filter: {
                                            hasError: onlyErrors || undefined,
                                        },
                                    });
                                }}
                                style={{
                                    width: '100%',
                                    fontSize: 'var(--font-size-xs)',
                                    padding: '6px',
                                    background: 'var(--flesh-medium)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-primary)',
                                }}
                            >
                                Apply Filters
                            </button>
                        </div>
                    </div>
                    <button
                        className="btn-infected"
                        onClick={() => {
                            setActiveTab('topology');
                            if (selectedAppId) {
                                navigate(`/apps/${effectiveSelectedAppId || ''}`);
                            }
                        }}
                        style={{
                            width: '100%',
                            fontSize: 'var(--font-size-xs)',
                            padding: 'var(--spacing-sm)',
                            background: !location.pathname.endsWith(
                                '/stimulations'
                            )
                                ? 'var(--flesh-infected)'
                                : 'var(--flesh-medium)',
                            color: !location.pathname.endsWith('/stimulations')
                                ? 'var(--text-primary)'
                                : 'var(--text-secondary)',
                            borderColor: !location.pathname.endsWith(
                                '/stimulations'
                            )
                                ? 'var(--infection-green)'
                                : 'var(--border-primary)',
                            boxShadow: !location.pathname.endsWith(
                                '/stimulations'
                            )
                                ? '0 0 8px var(--infection-green)'
                                : 'none',
                        }}
                    >
                        🗺️ Network Topology
                    </button>
                    {selectedAppId && (
                        <button
                            className="btn-infected"
                            onClick={() =>
                                navigate(
                                    `/apps/${
                                        effectiveSelectedAppId || ''
                                    }/stimulations`
                                )
                            }
                            style={{
                                width: '100%',
                                fontSize: 'var(--font-size-xs)',
                                padding: 'var(--spacing-sm)',
                                background: location.pathname.endsWith(
                                    '/stimulations'
                                )
                                    ? 'var(--flesh-infected)'
                                    : 'var(--flesh-medium)',
                                color: location.pathname.endsWith(
                                    '/stimulations'
                                )
                                    ? 'var(--text-primary)'
                                    : 'var(--text-secondary)',
                                borderColor: location.pathname.endsWith(
                                    '/stimulations'
                                )
                                    ? 'var(--infection-green)'
                                    : 'var(--border-primary)',
                                boxShadow: location.pathname.endsWith(
                                    '/stimulations'
                                )
                                    ? '0 0 8px var(--infection-green)'
                                    : 'none',
                            }}
                        >
                            ⚡ Stimulations
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
