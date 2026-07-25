import type { TExoSchema } from '@exodra/core';
import { bindable, derive } from '@exodra/reactivity';
import { reactIsland } from '@exodra/react';
import { combine } from '@oimdb/exodra';
import type { TExoRouter } from '@exodra/router';
import { PerformanceMonitor } from './PerformanceMonitor';
import { SignalDebugger } from './SignalDebugger';
import { contextStoreMonitor } from './ContextStoreMonitor';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { isStimulationsPath } from '../app/routes';
import type { DevtoolsSocket } from '../app/controllers/socket';
import type { AppSelection } from '../app/controllers/selection';
import type { TApp } from '../model';

// Native Exodra port of the sidebar. Its own chrome (title, connected-apps list,
// connection status, filters, nav buttons) is native and wired straight to the
// router + controllers; the four heavy panels (PerformanceMonitor, SignalDebugger,
// ContextStoreMonitor, AnalyticsDashboard) are still React, hosted here as
// @exodra/react islands until they are ported too.

const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const ROOT_STYLE =
    'width:325px;min-width:325px;background:var(--bg-panel);padding:var(--spacing-xl);' +
    'border-right:2px solid var(--border-infected);overflow-y:auto;' +
    'box-shadow:inset 0 0 10px var(--shadow-blood)';

const PANEL_WRAP = 'margin-bottom:var(--spacing-md)';

export interface SidebarParams {
    router: TExoRouter;
    socket: DevtoolsSocket;
    selection: AppSelection;
}

export function sidebarView({
    router,
    socket,
    selection,
}: SidebarParams): TExoSchema {
    const { connectionStatus } = socket;
    const {
        connectedApps,
        selectedAppId,
        effectiveSelectedAppId,
        selectedCnsId,
        cnsIdsForApp,
    } = selection;
    const onlyErrors = bindable(false);

    // ── Panel island props (reactive on selection) ───────────────────────────
    const signalProps = combine([effectiveSelectedAppId, selectedCnsId], () => ({
        wsRef: socket.wsRef,
        selectedAppId: effectiveSelectedAppId.getValue(),
        selectedCnsId: selectedCnsId.getValue() || undefined,
    }));
    const appIdProps = combine([effectiveSelectedAppId], () => ({
        selectedAppId: effectiveSelectedAppId.getValue(),
    }));

    // ── Connected apps list (re-renders on apps set OR selection change) ──────
    const appCard = (app: TApp, selected: boolean): TExoSchema => (
        <div
            static={{
                class: `pulse-infection ${selected ? 'decay-glow' : ''}`,
                style:
                    `background:${selected ? 'var(--flesh-infected)' : 'var(--bg-card)'};` +
                    'padding:var(--spacing-md);border-radius:var(--radius-sm);' +
                    'margin-bottom:var(--spacing-sm);' +
                    `border-left:4px solid ${selected ? 'var(--infection-green)' : 'var(--infection-red)'};` +
                    `border:2px solid ${selected ? 'var(--border-infected)' : 'var(--border-accent)'};` +
                    `box-shadow:${selected ? '0 0 15px var(--shadow-infection)' : '0 2px 4px var(--shadow-dark)'};` +
                    'cursor:pointer;transition:all var(--transition-medium)',
            }}
            handlers={{ onClick: () => selection.selectApp(app.id) }}
        >
            <div
                static={{
                    style: 'font-weight:bold;margin-bottom:var(--spacing-xs);color:var(--text-primary);font-size:var(--font-size-base)',
                }}
            >
                🧠 {app.name}
            </div>
            <div
                static={{
                    style: 'font-size:var(--font-size-xs);color:var(--text-secondary);font-family:var(--font-primary)',
                }}
            >
                {app.id}
            </div>
            <div
                static={{
                    style:
                        `font-size:var(--font-size-xs);color:${selected ? 'var(--infection-green)' : 'var(--text-success)'};` +
                        'margin-top:var(--spacing-xs)',
                }}
            >
                {selected ? '🎯 MONITORING' : '🟢 CONNECTED'}
            </div>
        </div>
    );

    const emptyCard: TExoSchema = (
        <div
            static={{
                style:
                    'color:var(--text-muted);font-style:italic;text-align:center;' +
                    'padding:var(--spacing-xl);background:var(--bg-card);' +
                    'border-radius:var(--radius-sm);border:1px dashed var(--border-primary)',
            }}
        >
            📱 No connected applications
        </div>
    );

    const appCards = combine([connectedApps, selectedAppId], () => {
        const apps = connectedApps.getValue();
        const sel = selectedAppId.getValue();
        if (!apps.length) return [emptyCard];
        return apps.map(app => appCard(app, sel === app.id));
    });

    const appsCount = derive(
        connectedApps,
        apps => `📱 CONNECTED APPS (${apps?.length || 0})`
    );

    // ── Connection status + monitoring block ─────────────────────────────────
    const statusColor = (s: string): string =>
        s === 'connected'
            ? 'var(--text-success)'
            : s === 'connecting'
            ? 'var(--text-warning)'
            : 'var(--text-error)';
    const dotColor = (s: string): string =>
        s === 'connected'
            ? 'var(--infection-green)'
            : s === 'connecting'
            ? 'var(--infection-yellow)'
            : 'var(--infection-red)';
    const statusLabel = (s: string): string =>
        s === 'connected'
            ? '✅ Server Connected'
            : s === 'connecting'
            ? '🔄 Connecting...'
            : '❌ Disconnected';

    const statusBlock = combine(
        [
            connectionStatus,
            selectedAppId,
            connectedApps,
            selectedCnsId,
            cnsIdsForApp,
            router.location,
        ],
        () => {
            const status = connectionStatus.getValue();
            const appId = selectedAppId.getValue();
            const apps = connectedApps.getValue();
            const cnsIds = cnsIdsForApp.getValue();
            const monitoredName =
                apps.find(a => a.id === appId)?.name || appId || '';

            const cnsSelect: TExoSchema | string =
                appId && cnsIds.length > 1 ? (
                    <div static={{ style: 'margin-top:6px' }}>
                        <label static={{ style: 'font-size:10px;color:var(--text-muted)' }}>
                            CNS Instance:
                        </label>
                        <select
                            static={{
                                style: 'margin-left:6px;padding:2px 4px;font-size:10px;background:var(--bg-panel);color:var(--text-primary);border:1px solid var(--border-primary)',
                            }}
                            handlers={{
                                onChange: (e: Event) =>
                                    selection.selectCns(
                                        (e.target as HTMLSelectElement).value || null
                                    ),
                            }}
                        >
                            {cnsIds.map(id => (
                                <option
                                    static={{
                                        value: id,
                                        selected: id === selectedCnsId.getValue(),
                                    }}
                                >
                                    {id}
                                </option>
                            ))}
                        </select>
                    </div>
                ) : (
                    ''
                );

            const monitoring: TExoSchema | string = appId ? (
                <div
                    static={{
                        style:
                            'font-size:var(--font-size-xs);color:var(--infection-green);' +
                            'margin-bottom:var(--spacing-lg);padding:var(--spacing-xs);' +
                            'background:var(--bg-secondary);border-radius:var(--radius-sm);' +
                            'border:1px solid var(--border-infected)',
                    }}
                >
                    🎯 Monitoring: {monitoredName}
                    {cnsSelect}
                </div>
            ) : (
                ''
            );

            return (
                <div>
                    <h3
                        static={{
                            style: 'margin:0 0 var(--spacing-md) 0;font-size:var(--font-size-sm);color:var(--text-muted);letter-spacing:1px',
                        }}
                    >
                        🔗 CONNECTION STATUS
                    </h3>
                    <div
                        static={{
                            style:
                                `font-size:var(--font-size-xs);color:${statusColor(status)};` +
                                'margin-bottom:var(--spacing-xs);display:flex;align-items:center;gap:var(--spacing-xs)',
                        }}
                    >
                        <div
                            static={{
                                style: `width:8px;height:8px;border-radius:50%;background-color:${dotColor(status)}`,
                            }}
                        />
                        {statusLabel(status)}
                    </div>
                    {monitoring}
                    {filterAndNav()}
                </div>
            );
        }
    );

    // ── Filter controls + nav buttons (depend on route + selection) ──────────
    const filterAndNav = (): TExoSchema => {
        const loc = router.getLocation();
        const isStim = isStimulationsPath(loc.pathname);
        const appId = selectedAppId.getValue();
        const eff = effectiveSelectedAppId.getValue() || '';

        const navBtnStyle = (active: boolean): string =>
            'width:100%;font-size:var(--font-size-xs);padding:var(--spacing-sm);' +
            `background:${active ? 'var(--flesh-infected)' : 'var(--flesh-medium)'};` +
            `color:${active ? 'var(--text-primary)' : 'var(--text-secondary)'};` +
            `border-color:${active ? 'var(--infection-green)' : 'var(--border-primary)'};` +
            `box-shadow:${active ? '0 0 8px var(--infection-green)' : 'none'}`;

        return (
            <div static={{ style: 'display:flex;flex-direction:column;gap:var(--spacing-sm)' }}>
                <div
                    static={{
                        style: 'border:1px solid var(--border-primary);border-radius:var(--radius-sm);padding:8px;background:var(--bg-card)',
                    }}
                >
                    <div
                        static={{
                            style: 'font-size:var(--font-size-xs);color:var(--text-muted);margin-bottom:6px',
                        }}
                    >
                        Stimulation Filters (optional)
                    </div>
                    <div static={{ style: 'display:grid;gap:6px' }}>
                        <label
                            static={{
                                style: 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-secondary)',
                            }}
                        >
                            <input
                                static={{ type: 'checkbox' }}
                                bindable={{ checked: onlyErrors }}
                                handlers={{
                                    onChange: (e: Event) =>
                                        onlyErrors.setValue(
                                            (e.target as HTMLInputElement).checked
                                        ),
                                }}
                            />
                            Only errors
                        </label>
                        <button
                            static={{
                                class: 'btn-infected',
                                style: 'width:100%;font-size:var(--font-size-xs);padding:6px;background:var(--flesh-medium);color:var(--text-secondary);border-color:var(--border-primary)',
                            }}
                            handlers={{
                                onClick: () => {
                                    if (!appId) return;
                                    socket.send({
                                        type: 'stimulations.query',
                                        requestId: genRequestId(),
                                        appId,
                                        filter: {
                                            hasError: onlyErrors.getValue() || undefined,
                                        },
                                    });
                                },
                            }}
                        >
                            Apply Filters
                        </button>
                    </div>
                </div>
                <button
                    static={{ class: 'btn-infected', style: navBtnStyle(!isStim) }}
                    handlers={{
                        onClick: () => {
                            if (appId) void router.navigate(`/apps/${eff}`);
                        },
                    }}
                >
                    🗺️ Network Topology
                </button>
                {appId
                    ? (
                          <button
                              static={{ class: 'btn-infected', style: navBtnStyle(isStim) }}
                              handlers={{
                                  onClick: () =>
                                      void router.navigate(`/apps/${eff}/stimulations`),
                              }}
                          >
                              ⚡ Stimulations
                          </button>
                      )
                    : ''}
            </div>
        );
    };

    return (
        <div static={{ class: 'flicker', style: ROOT_STYLE }}>
            <h2
                static={{
                    style: 'margin:0 0 var(--spacing-md) 0;color:var(--text-primary);font-size:var(--font-size-xl)',
                }}
            >
                🧠 CNStra DevTools
            </h2>

            <div static={{ style: PANEL_WRAP, children: [reactIsland(PerformanceMonitor, {})] }} />
            <div static={{ style: PANEL_WRAP, children: [reactIsland(SignalDebugger, signalProps)] }} />
            <div static={{ style: PANEL_WRAP, children: [contextStoreMonitor(effectiveSelectedAppId)] }} />
            <div static={{ style: 'margin-bottom:var(--spacing-xl)', children: [reactIsland(AnalyticsDashboard, appIdProps)] }} />

            <div static={{ style: 'margin-bottom:var(--spacing-xl)' }}>
                <div
                    static={{
                        style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--spacing-md)',
                    }}
                >
                    <h3
                        static={{
                            style: 'margin:0;font-size:var(--font-size-sm);color:var(--text-muted);letter-spacing:1px',
                        }}
                        bindable={{ textContent: appsCount }}
                    />
                    <button
                        static={{
                            style: 'background:var(--bg-card);border:1px solid var(--border-accent);color:var(--text-primary);padding:var(--spacing-xs) var(--spacing-sm);border-radius:var(--radius-sm);font-size:var(--font-size-xs);cursor:pointer;transition:all 0.2s ease',
                        }}
                        handlers={{
                            onClick: () => {
                                socket.send({ type: 'apps.query', requestId: genRequestId() });
                                socket.send({ type: 'topology.query', requestId: genRequestId() });
                            },
                        }}
                    >
                        🔄 Refresh
                    </button>
                </div>
                <div bindable={{ children: appCards }} />
            </div>

            <div bindable={{ children: statusBlock }} />
        </div>
    );
}
