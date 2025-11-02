import React, {
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo,
} from 'react';
import { mainCNS } from '../cns';
import { wsAxon } from '../cns/ws/WsAxon';
import { appModelAxon } from '../cns/controller-layer/AppModelAxon';
// import { useSelectEntitiesByPks, useSelectPksByIndexKey } from '@oimdb/react';
import { db } from '../model';
import CNSGraph from './CNSGraph';
import {
    HashRouter,
    Routes,
    Route,
    useNavigate,
    useParams,
    useLocation,
    Navigate,
} from 'react-router-dom';
import NeuronDetailsPanel from './NeuronDetailsPanel';
import EmptyGraphPlaceholder from './EmptyGraphPlaceholder';
import StimulationsPage from './StimulationsPage';
import { PerformanceMonitor } from './PerformanceMonitor';
import { SignalDebugger } from './SignalDebugger';
import { ContextStoreMonitor } from './ContextStoreMonitor';
import { AnalyticsDashboard } from './AnalyticsDashboard';
// import { dataLimiter } from '../utils/dataLimiter';

import {
    useSelectEntitiesByIndexKey,
    useSelectPksByIndexKey,
} from '@oimdb/react';
import { OIMReactiveIndexManual } from '@oimdb/core';
import { sanitizeFilters } from '../utils/filterSanitizer';

// Define types for neuron and stimulation data
interface StimulationData {
    id: string;
    timestamp: number;
    signal: unknown;
    sourceNeuron?: string;
    targetNeuron?: string;
}

interface NeuronData {
    id: string;
    name: string;
    x: number;
    y: number;
    stimulationCount: number;
    stimulations: StimulationData[];
    type: 'input' | 'processing' | 'output';
    responseCount?: number;
    errorCount?: number;
    avgDuration?: number;
}

interface ConnectionData {
    from: string;
    to: string;
    weight: number;
    stimulationCount: number;
    label?: string;
}

// Debounce utility
const debounce = <T extends (...args: any[]) => void>(
    func: T,
    delay: number
): ((...args: Parameters<T>) => void) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
};

export const App: React.FC = () => {
    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Navigate to="/apps" replace />} />
                <Route path="/apps" element={<AppInner />} />
                <Route path="/apps/:appId" element={<AppInner />} />
                <Route
                    path="/apps/:appId/stimulations"
                    element={<AppInner />}
                />
            </Routes>
        </HashRouter>
    );
};

export const AppInner: React.FC = () => {
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const location = useLocation();
    const [activeTab, setActiveTab] = useState<'topology'>('topology');
    const [selectedNeuron, setSelectedNeuron] = useState<NeuronData | null>(
        null
    );
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<
        'connecting' | 'connected' | 'disconnected'
    >('connecting');
    const [selectedCnsId, setSelectedCnsId] = useState<string | null>(null);
    const [lastSnapshotSize, setLastSnapshotSize] = useState<number | null>(
        null
    );
    const [lastSnapshotWarning, setLastSnapshotWarning] = useState<string>('');
    const [exportFrom, setExportFrom] = useState<string>('');
    const [exportTo, setExportTo] = useState<string>('');
    const [exportOffset, setExportOffset] = useState<string>('');
    const [exportLimit, setExportLimit] = useState<string>('');
    const [onlyErrors, setOnlyErrors] = useState<boolean>(false);
    const [errorContains, setErrorContains] = useState<string>('');
    const [cnsDataLoaded, setCnsDataLoaded] = useState<boolean>(false);

    // Helper: one-time message wait
    const waitForMessageOnce = React.useCallback(
        (predicate: (msg: any) => boolean): Promise<any> => {
            return new Promise(resolve => {
                const handler = (ev: MessageEvent) => {
                    try {
                        const msg =
                            typeof ev.data === 'string'
                                ? JSON.parse(ev.data)
                                : null;
                        if (msg && predicate(msg)) {
                            wsRef.current?.removeEventListener(
                                'message',
                                handler as any
                            );
                            resolve(msg);
                        }
                    } catch {}
                };
                wsRef.current?.addEventListener('message', handler as any);
            });
        },
        []
    );

    // Helper: trigger JSON download
    const downloadJson = React.useCallback(
        (data: unknown, filename: string) => {
            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },
        []
    );

    // Export actions
    const handleExportTopology = React.useCallback(async () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const appId = selectedAppId || undefined;
        const filename = `topology${
            appId ? '-' + appId : ''
        }-${Date.now()}.json`;
        const wait = waitForMessageOnce(
            msg => msg && msg.type === 'apps:topology'
        );
        ws.send(
            JSON.stringify({
                type: 'apps:export-topology',
                ...(appId ? { appId } : {}),
            })
        );
        const resp = await wait;
        downloadJson(resp, filename);
    }, [selectedAppId, waitForMessageOnce, downloadJson]);

    const handleExportStimulations = React.useCallback(async () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const appId = selectedAppId;
        if (!appId) return;
        const filters = sanitizeFilters({
            fromTimestamp: exportFrom ? Number(exportFrom) : undefined,
            toTimestamp: exportTo ? Number(exportTo) : undefined,
            offset: exportOffset ? Number(exportOffset) : undefined,
            limit: exportLimit ? Number(exportLimit) : undefined,
        });
        const filename = `stimulations-${appId}-${Date.now()}.json`;
        const wait = waitForMessageOnce(
            msg => msg && msg.type === 'apps:export-stimulations'
        );
        ws.send(
            JSON.stringify({
                type: 'apps:export-stimulations',
                appId,
                ...filters,
                hasError: onlyErrors || undefined,
                errorContains: errorContains || undefined,
            })
        );
        const resp = await wait;
        downloadJson(resp, filename);
    }, [selectedAppId, waitForMessageOnce, downloadJson]);

    const handleExportResponses = React.useCallback(async () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const cnsId = selectedCnsId || selectedAppId;
        if (!cnsId) return;
        const filters = sanitizeFilters({
            fromTimestamp: exportFrom ? Number(exportFrom) : undefined,
            toTimestamp: exportTo ? Number(exportTo) : undefined,
            offset: exportOffset ? Number(exportOffset) : undefined,
            limit: exportLimit ? Number(exportLimit) : undefined,
        });
        const filename = `responses-${cnsId}-${Date.now()}.json`;
        const wait = waitForMessageOnce(
            msg => msg && msg.type === 'cns:export-responses'
        );
        ws.send(
            JSON.stringify({
                type: 'cns:export-responses',
                cnsId,
                ...filters,
                hasError: onlyErrors || undefined,
                errorContains: errorContains || undefined,
            })
        );
        const resp = await wait;
        downloadJson(resp, filename);
    }, [
        selectedCnsId,
        selectedAppId,
        waitForMessageOnce,
        downloadJson,
        exportFrom,
        exportTo,
        exportOffset,
        exportLimit,
        onlyErrors,
        errorContains,
    ]);

    // Helper: Safe WebSocket send with error handling
    const safeSend = useCallback((message: any) => {
        try {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                console.warn('WebSocket not ready, skipping message:', message);
                return false;
            }
            ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Failed to send WebSocket message:', error, message);
            return false;
        }
    }, []);

    // Handle neuron click
    const handleNeuronClick = (neuron: NeuronData) => {
        console.log('🎯 NEURON CLICKED:', {
            name: neuron.name,
            id: neuron.id,
            stimulationCount: neuron.stimulationCount,
            stimulationsArrayLength: neuron.stimulations?.length || 0,
            stimulationsArray: neuron.stimulations,
        });
        setSelectedNeuron(neuron);
    };

    // Handle closing neuron details panel
    const handleCloseNeuronDetails = () => {
        setSelectedNeuron(null);
    };

    // Reconnection logic
    const [reconnectAttempts, setReconnectAttempts] = useState(0);
    const [reconnectTimer, setReconnectTimer] = useState<NodeJS.Timeout | null>(
        null
    );
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000; // 2 seconds

    const connectToServer = React.useCallback(() => {
        const url =
            (window as any).__CNSTRA_DEVTOOLS_WS__ || 'ws://localhost:8080';
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener('open', () => {
            console.log('🔗 Connected to DevTools server');
            setConnectionStatus('connected');
            setReconnectAttempts(0); // Reset on successful connection

            // Identify as DevTools client
            safeSend({ type: 'devtools-client-connect' });

            // Request initial data
            console.log('📡 Requesting initial data...');
            safeSend({ type: 'apps:get-topology' });
            safeSend({ type: 'apps:list' });
            safeSend({
                type: 'apps:get-responses',
                appId: 'all',
                limit: 1000,
                fromTimestamp: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
                toTimestamp: Date.now(),
            });

            mainCNS.stimulate(wsAxon.open.createSignal());
        });

        ws.addEventListener('message', ev => {
            mainCNS.stimulate(wsAxon.message.createSignal(ev.data));
        });

        ws.addEventListener('close', ev => {
            console.log('🔌 Disconnected from DevTools server');
            setConnectionStatus('disconnected');
            mainCNS.stimulate(
                wsAxon.close.createSignal({ code: ev.code, reason: ev.reason })
            );

            // Attempt reconnection
            if (reconnectAttempts < maxReconnectAttempts) {
                console.log(
                    `🔄 Attempting reconnection ${
                        reconnectAttempts + 1
                    }/${maxReconnectAttempts}...`
                );
                setConnectionStatus('connecting');
                const timer = setTimeout(() => {
                    setReconnectAttempts(prev => prev + 1);
                    connectToServer();
                }, reconnectDelay);
                setReconnectTimer(timer);
            } else {
                console.log('❌ Max reconnection attempts reached');
            }
        });

        ws.addEventListener('error', error => {
            console.error('❌ DevTools WebSocket error:', error);
            setConnectionStatus('disconnected');
            mainCNS.stimulate(
                wsAxon.error.createSignal({ message: 'ws error' })
            );
        });
    }, [reconnectAttempts, safeSend]);

    useEffect(() => {
        // Initialize data limiter
        // dataLimiter.startCleanup();

        connectToServer();

        return () => {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            // dataLimiter.stopCleanup();
        };
    }, []);

    const navigate = useNavigate();
    const params = useParams();
    const routeAppId = params.appId as string | undefined;

    const connectedApps = useSelectEntitiesByIndexKey(
        db.apps,
        db.apps.indexes.all as OIMReactiveIndexManual<'all', string>,
        'all'
    );

    // Debug: Log when connectedApps changes
    React.useEffect(() => {
        console.log('🔍 UI: connectedApps changed:', {
            count: connectedApps?.length || 0,
            apps:
                connectedApps?.map(app => ({
                    appId: app.appId,
                    appName: app.appName,
                })) || [],
        });
    }, [connectedApps]);

    // CNS list for selected app
    const cnsIdsForApp = React.useMemo(() => {
        if (!selectedAppId) return [] as string[];
        const pks = (db.cns.indexes.appId.getPksByKey(selectedAppId) ||
            new Set()) as Set<string>;
        return Array.from(pks);
    }, [selectedAppId]);

    // Debounced request stimulations function
    const debouncedRequestStimulations = useMemo(
        () =>
            debounce((apps: readonly any[]) => {
                if (!apps || apps.length === 0) return;
                console.log(
                    '🧠 Requesting stimulations for',
                    apps.length,
                    'apps'
                );
                apps.forEach(app => {
                    safeSend({
                        type: 'apps:get-stimulations',
                        appId: app.appId,
                        limit: 1000,
                    });
                });
            }, 1000),
        [safeSend]
    );

    // Request stimulations when apps are connected
    useEffect(() => {
        if (connectedApps && connectedApps.length > 0) {
            debouncedRequestStimulations(connectedApps);
        }
    }, [connectedApps, debouncedRequestStimulations]);

    // Request replays for connected apps
    useEffect(() => {
        if (connectedApps && connectedApps.length > 0) {
            connectedApps.forEach(app => {
                safeSend({
                    type: 'apps:get-replays',
                    appId: app.appId,
                });
            });
        }
    }, [connectedApps, safeSend]);

    // Observe selected app id from DB index (single selection)
    const selectedAppPks = useSelectPksByIndexKey(
        db.apps.indexes.selected as OIMReactiveIndexManual<'selected', string>,
        'selected'
    );
    const effectiveSelectedAppId =
        routeAppId ||
        (selectedAppPks && selectedAppPks[0]) ||
        selectedAppId ||
        null;

    // Auto-select first app if none selected and apps are available
    React.useEffect(() => {
        if (
            !effectiveSelectedAppId &&
            connectedApps &&
            connectedApps.length > 0
        ) {
            const appId = connectedApps[0].appId;
            setSelectedAppId(appId);
            try {
                (
                    db.apps.indexes.selected as OIMReactiveIndexManual<
                        'selected',
                        string
                    >
                ).setPks('selected', [appId]);
            } catch {}
            // ensure URL reflects selection
            if (!routeAppId) navigate(`/apps/${appId}`);
        }
    }, [connectedApps, effectiveSelectedAppId]);

    // Keep local state in sync with DB-selected index
    React.useEffect(() => {
        if (
            selectedAppPks &&
            selectedAppPks[0] &&
            selectedAppId !== selectedAppPks[0]
        ) {
            setSelectedAppId(selectedAppPks[0]);
        }
    }, [selectedAppPks]);

    // Auto-select first CNS if none selected or selection invalid
    React.useEffect(() => {
        if (!selectedAppId) {
            setSelectedCnsId(null);
            setCnsDataLoaded(false);
            return;
        }
        if (cnsIdsForApp.length > 0) {
            if (!selectedCnsId || !cnsIdsForApp.includes(selectedCnsId)) {
                setSelectedCnsId(cnsIdsForApp[0] || null);
            }
        } else {
            setSelectedCnsId(null);
        }
    }, [selectedAppId, cnsIdsForApp]);

    // Handle CNS response and request data
    const handleCnsResponse = useCallback(
        (msg: any) => {
            if (msg.type === 'apps:cns' && msg.appId === selectedAppId) {
                const cnsIds = msg.cns.map((c: any) => c.cnsId);
                console.log(
                    '📡 Received CNS list, requesting data for:',
                    cnsIds
                );

                // Request data for each CNS
                cnsIds.forEach((cnsId: string) => {
                    safeSend({ type: 'cns:get-neurons', cnsId });
                    safeSend({ type: 'cns:get-dendrites', cnsId });
                    safeSend({ type: 'cns:get-collaterals', cnsId });
                    safeSend({
                        type: 'cns:get-responses',
                        cnsId,
                        limit: 1000,
                    });
                });

                setCnsDataLoaded(true);
            }
        },
        [selectedAppId, safeSend]
    );

    // Listen for CNS responses
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws) return;

        const messageHandler = (ev: MessageEvent) => {
            try {
                const msg =
                    typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
                if (msg) {
                    handleCnsResponse(msg);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.addEventListener('message', messageHandler);
        return () => ws.removeEventListener('message', messageHandler);
    }, [handleCnsResponse]);

    // Fetch topology and data for selected app/CNS via REST-over-WS
    useEffect(() => {
        if (!selectedAppId) return;

        // Reset CNS data loaded state
        setCnsDataLoaded(false);

        // Request CNS list for the selected app
        safeSend({ type: 'apps:get-cns', appId: selectedAppId });

        // Request stimulations for the selected app
        safeSend({
            type: 'apps:get-stimulations',
            appId: selectedAppId,
            limit: 1000,
        });
    }, [selectedAppId, safeSend]);

    // Always call hooks unconditionally (Rules of Hooks)
    const allNeuronsRaw = useSelectEntitiesByIndexKey(
        db.neurons,
        db.neurons.indexes.appId,
        effectiveSelectedAppId || 'dummy-id' // Use dummy ID when no app selected
    );

    const allDendritesRaw = useSelectEntitiesByIndexKey(
        db.dendrites,
        db.dendrites.indexes.appId,
        effectiveSelectedAppId || 'dummy-id'
    );

    const allResponsesRaw = useSelectEntitiesByIndexKey(
        db.responses,
        db.responses.indexes.appId,
        effectiveSelectedAppId || 'dummy-id'
    );

    const allStimulationsRaw = useSelectEntitiesByIndexKey(
        db.stimulations,
        db.stimulations.indexes.appId,
        effectiveSelectedAppId || 'dummy-id'
    );

    const allCollateralsRaw = useSelectEntitiesByIndexKey(
        db.collaterals,
        db.collaterals.indexes.appId,
        effectiveSelectedAppId || 'dummy-id'
    );

    // Filter out data when no app is selected and undefined elements
    const allNeurons = effectiveSelectedAppId
        ? (allNeuronsRaw || []).filter(
              (n): n is NonNullable<typeof n> => n != null
          )
        : null;
    const allDendrites = effectiveSelectedAppId
        ? (allDendritesRaw || []).filter(
              (d): d is NonNullable<typeof d> => d != null
          )
        : null;
    const allResponses = effectiveSelectedAppId
        ? (allResponsesRaw || []).filter(
              (r): r is NonNullable<typeof r> => r != null
          )
        : null;
    const allStimulations = effectiveSelectedAppId
        ? (allStimulationsRaw || []).filter(
              (s): s is NonNullable<typeof s> => s != null
          )
        : null;
    const allCollaterals = effectiveSelectedAppId
        ? (allCollateralsRaw || []).filter(
              (c): c is NonNullable<typeof c> => c != null
          )
        : null;

    // Expose counts for E2E assertions
    React.useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                (window as any).__cnstraCounts = {
                    stimulations: Array.isArray(allStimulations)
                        ? allStimulations.length
                        : 0,
                    responses: Array.isArray(allResponses)
                        ? allResponses.length
                        : 0,
                };
            }
        } catch {}
    }, [allStimulations, allResponses]);

    console.log('🔍 App.tsx query results for app:', effectiveSelectedAppId, {
        allNeuronsRaw: allNeuronsRaw?.length || 0,
        allDendritesRaw: allDendritesRaw?.length || 0,
        allResponsesRaw: allResponsesRaw?.length || 0,
        allCollateralsRaw: allCollateralsRaw?.length || 0,
        allNeurons: allNeurons?.length || 0,
        allDendrites: allDendrites?.length || 0,
        allResponses: allResponses?.length || 0,
        allCollaterals: allCollaterals?.length || 0,
        firstNeuron: allNeurons?.[0],
        firstDendrite: allDendrites?.[0],
        firstResponse: allResponses?.[0],
        firstCollateral: allCollaterals?.[0],
    });

    // Debug: Check what's actually in the database
    console.log('🔍 STIMULATION COUNT DEBUG:', {
        selectedApp: effectiveSelectedAppId,
        totalResponsesInDB: db.responses.getAll().length,
        totalStimulationsInDB: db.stimulations.getAll().length,
        totalDendritesInDB: db.dendrites.getAll().length,
        totalAppsInDB: db.apps.getAll().length,
        filteredResponses: allResponses?.length || 0,
        filteredStimulations: allStimulations?.length || 0,
        filteredDendrites: allDendrites?.length || 0,
        allStimulationsSample: allStimulations?.slice(0, 3),
        allDendritesSample: allDendrites?.slice(0, 3),
        dbStimulationSample: db.stimulations
            .getAll()
            .slice(0, 3)
            .map(s => ({
                stimulationId: (s as any).stimulationId,
                appId: (s as any).appId,
                collateralName: (s as any).collateralName,
            })),
        allStimulationsDebug: allStimulations?.map(s => ({
            stimulationId: (s as any).stimulationId,
            collateralName: (s as any).collateralName,
        })),
        dbDendritesSample: db.dendrites
            .getAll()
            .slice(0, 3)
            .map(d => ({
                id: d.id,
                appId: d.appId,
                neuronId: d.neuronId,
                collateralName: d.name,
                cnsId: d.cnsId,
            })),
        allStimulationsAppIds: db.stimulations
            .getAll()
            .slice(0, 10)
            .map(s => (s as any).appId),
        stimulationIndexKeys: Array.from(
            db.stimulations.indexes.appId.getKeys() || []
        ),
    });

    // Convert real database data to graph format using useMemo
    const realGraphData = React.useMemo((): {
        neurons: NeuronData[];
        connections: ConnectionData[];
    } => {
        console.log('🔄 Converting data to graph format...');
        console.log('  allNeurons:', allNeurons);
        console.log('  allDendrites:', allDendrites);
        console.log('  allResponses:', allResponses);

        // Check if we have valid neuron data
        if (
            !allNeurons ||
            !Array.isArray(allNeurons) ||
            allNeurons.length === 0
        ) {
            console.log('❌ No valid neurons found');
            return { neurons: [], connections: [] };
        }

        console.log('✅ Found', allNeurons.length, 'neurons, converting...');

        // Create neuron nodes
        const graphNeurons: NeuronData[] = allNeurons.map((neuron, index) => {
            // Debug: Log available response collateral names vs current neuron
            const responseOutputCollaterals = Array.isArray(allResponses)
                ? [
                      ...new Set(
                          allResponses
                              .filter(r => r != null)
                              .map(r => r.outputCollateralName)
                              .filter(Boolean)
                      ),
                  ]
                : [];

            console.log(
                `🔍 Neuron "${neuron.name}" (id: "${neuron.id}") vs response output collaterals:`,
                responseOutputCollaterals
            );

            // Compute response count for this neuron from responses
            // Find responses where this neuron is the output (via collaterals)
            const neuronCollateralNames = allCollaterals
                ?.filter(c => c.neuronId === neuron.id)
                .map(c => c.name);

            const outgoingResponses = Array.isArray(allResponses)
                ? allResponses.filter(r => {
                      if (
                          !r ||
                          !neuronCollateralNames ||
                          !r.outputCollateralName
                      )
                          return false;
                      return neuronCollateralNames.includes(
                          r.outputCollateralName as string
                      );
                  })
                : [];

            // Find responses where this neuron is the input (via dendrites)
            const neuronDendriteNames = allDendrites
                ?.filter(d => d.neuronId === neuron.id)
                .map(d => d.name);

            const incomingResponses = Array.isArray(allResponses)
                ? allResponses.filter(r => {
                      if (!r || !neuronDendriteNames || !r.inputCollateralName)
                          return false;
                      return neuronDendriteNames.includes(
                          r.inputCollateralName as string
                      );
                  })
                : [];

            // incomingResponses already calculated above

            // Total responses = outgoing + incoming (dedupe by responseId)
            const allRelevantResponses = [
                ...outgoingResponses,
                ...incomingResponses,
            ];
            const uniqueResponses = allRelevantResponses.filter(
                (resp, index, arr) =>
                    arr.findIndex(r => r.responseId === resp.responseId) ===
                    index
            );
            const responseCount = uniqueResponses.length;

            // Debug response matching for neurons with low activity
            if (neuron.name === 'audit-service' || responseCount === 0) {
                console.log(`🔍 RESPONSE MATCHING DEBUG for ${neuron.name}:`);
                console.log(
                    `   Outgoing responses: ${outgoingResponses.length}`
                );
                console.log(
                    `   Incoming responses: ${incomingResponses.length}`
                );
                console.log(`   Total unique responses: ${responseCount}`);
                console.log(
                    `   Dendrites found: ${neuronDendriteNames?.length}`
                );
                console.log(
                    `   Listened collaterals: [${neuronDendriteNames?.join(
                        ', '
                    )}]`
                );

                // Debug collateral matching
                console.log(
                    `   Available response collaterals: [${Array.from(
                        new Set(
                            allResponses
                                ?.filter(r => r != null)
                                .map(r => r.outputCollateralName)
                        )
                    ).join(', ')}]`
                );
                console.log(
                    `   Available input collaterals: [${Array.from(
                        new Set(
                            allResponses
                                ?.filter(r => r != null)
                                .map(r => r?.inputCollateralName)
                                .filter(Boolean)
                        )
                    ).join(', ')}]`
                );
            }

            // Debug: Show which neuron has responses
            if (responseCount > 0) {
                console.log(
                    `💥 NEURON WITH RESPONSES: ${neuron.name} (${neuron.id}) -> ${responseCount} total responses`
                );
                console.log(
                    `   📤 Outgoing responses: ${outgoingResponses.length}, 📥 Incoming responses: ${incomingResponses.length}, 🔄 Unique responses: ${uniqueResponses.length}`
                );
                console.log(
                    `   🎯 Listens to collaterals: [${neuronDendriteNames?.join(
                        ', '
                    )}]`
                );
            } else {
                console.log(
                    `⚫ NEURON NO RESPONSES: ${neuron.name} (${neuron.id}) -> ${responseCount} responses`
                );
                console.log(
                    `   📤 Outgoing: ${outgoingResponses.length}, 📥 Incoming: ${incomingResponses.length}`
                );
                console.log(
                    `   🎯 Listens to collaterals: [${neuronDendriteNames?.join(
                        ', '
                    )}]`
                );
                console.log(
                    `   Available response collaterals: [${Array.from(
                        new Set(
                            allResponses
                                ?.filter(r => r != null)
                                .map(r => r.outputCollateralName)
                        )
                    ).join(', ')}]`
                );
                console.log(
                    `   Available input collaterals: [${Array.from(
                        new Set(
                            allResponses
                                ?.filter(r => r != null)
                                .map(r => r?.inputCollateralName)
                                .filter(Boolean)
                        )
                    ).join(', ')}]`
                );
            }

            // Enhanced positioning algorithm to prevent overlap
            const canvasWidth = 800;
            const canvasHeight = 600;
            const minDistance = 80; // minimum distance between neurons

            // Use a spiral layout with force-directed adjustments
            const spiralRadius = 120;
            const spiralSpacing = 25;
            const angle = index * 2.4 + index * 0.3; // golden angle approximation
            const radius = spiralRadius + index * spiralSpacing * 0.8;

            let x = canvasWidth / 2 + Math.cos(angle) * radius;
            let y = canvasHeight / 2 + Math.sin(angle) * radius * 0.7; // slightly flatten vertically

            // Add some organic randomness to break perfect patterns
            const randomOffset = 25;
            x += Math.sin(index * 7.3) * randomOffset;
            y += Math.cos(index * 5.7) * randomOffset;

            // Keep within canvas bounds with padding
            const padding = 60;
            x = Math.max(padding, Math.min(canvasWidth - padding, x));
            y = Math.max(padding, Math.min(canvasHeight - padding, y));

            // Calculate error count and average duration from unique responses
            const errorCount = uniqueResponses.filter(
                (r: any) => r?.error
            ).length;

            const durationsWithValues = uniqueResponses
                .map((r: any) => r?.duration)
                .filter((d: any) => typeof d === 'number' && d > 0);
            const avgDuration =
                durationsWithValues.length > 0
                    ? durationsWithValues.reduce(
                          (sum: number, d: number) => sum + d,
                          0
                      ) / durationsWithValues.length
                    : 0;

            const graphNeuron = {
                id: neuron.id,
                name: neuron.name,
                x: x,
                y: y,
                stimulationCount: responseCount,
                responseCount: uniqueResponses.length,
                errorCount: errorCount,
                avgDuration: avgDuration,
                stimulations:
                    incomingResponses.length > 0
                        ? incomingResponses
                              .slice(0, 10)
                              .map((response: any) => ({
                                  id: response.responseId,
                                  timestamp: response.timestamp,
                                  signal: {
                                      type: 'response',
                                      inputCollateral:
                                          response?.inputCollateralName,
                                      outputCollateral:
                                          response?.outputCollateralName,
                                      payload: response.outputPayload,
                                  },
                                  sourceNeuron: neuron.id,
                                  targetNeuron: undefined,
                              }))
                        : [],
                type: (index === 0
                    ? 'input'
                    : index === allNeurons.length - 1
                    ? 'output'
                    : 'processing') as 'input' | 'processing' | 'output',
            };

            console.log(
                '🧠 Created neuron:',
                graphNeuron.name,
                'with',
                graphNeuron.stimulationCount,
                'stimulations',
                'stimulationsArray:',
                graphNeuron.stimulations.length,
                'items'
            );
            return graphNeuron;
        });

        // Build real connections using dendrites:
        // each dendrite belongs to a neuron and references a collateral.
        // If any response shows this collateral as input -> output between two neurons,
        // connect source neuron -> dendrite.neuronId and label by collateral name.
        const graphConnections: ConnectionData[] = [];
        if (Array.isArray(allDendrites) && allDendrites.length > 0) {
            // Index dendrites by collateral and neuron
            const dendritesByCollateral = new Map<string, Set<string>>(); // collateralName(raw) -> set(neuronId)
            allDendrites.forEach(d => {
                const key = String(d.name).replace(/^.*:collateral:/, '');
                const set = dendritesByCollateral.get(key) || new Set<string>();
                set.add(d.neuronId);
                dendritesByCollateral.set(key, set);
            });

            // Build edges from responses, as they carry causal links
            const edgeKey = (from: string, to: string, label: string) =>
                `${from}->${to}::${label}`;
            const edgeMap = new Map<
                string,
                { from: string; to: string; label: string; count: number }
            >();

            // Infer collateral ownership from collateral data (since neurons don't have axonCollaterals)
            const ownerByCollateral = new Map<string, string>(); // collateralName -> owner neuronId
            if (Array.isArray(allCollaterals)) {
                allCollaterals.forEach(collateral => {
                    // Skip collaterals with invalid neuronIds (temporary fix for data consistency issue)
                    if (
                        collateral.neuronId === 'unknown' ||
                        !collateral.neuronId
                    ) {
                        console.warn(
                            `⚠️ Skipping collateral "${collateral.name}" with invalid neuronId: "${collateral.neuronId}"`
                        );
                        return;
                    }

                    // Use 'name' field for the stored collateral entities
                    const key = String(collateral.name).replace(
                        /^.*:collateral:/,
                        ''
                    );
                    ownerByCollateral.set(key, collateral.neuronId);
                });
            }

            console.log('🔍 CONNECTION BUILDING DEBUG:', {
                dendritesFound: allDendrites?.length || 0,
                neuronsFound: allNeurons?.length || 0,
                collateralsFound: allCollaterals?.length || 0,
                dendritesByCollateralSize: dendritesByCollateral.size,
                ownerByCollateralSize: ownerByCollateral.size,
                dendritesByCollateralSample: Array.from(
                    dendritesByCollateral.entries()
                ).slice(0, 3),
                ownerByCollateralSample: Array.from(
                    ownerByCollateral.entries()
                ).slice(0, 3),
            });

            // DETAILED DEBUG: Show actual data structures
            console.log('📡 COLLATERALS DEBUG:', {
                allCollaterals: allCollaterals,
                allCollateralsLength: allCollaterals?.length,
                allCollateralsRaw: allCollateralsRaw,
                allCollateralsRawLength: allCollateralsRaw?.length,
                isArray: Array.isArray(allCollaterals),
                effectiveSelectedAppId,
            });

            if (allCollaterals && allCollaterals.length > 0) {
                console.log('📡 RAW COLLATERALS:', allCollaterals.slice(0, 3));
                allCollaterals.slice(0, 3).forEach(c => {
                    const key = String(c.name).replace(/^.*:collateral:/, '');
                    console.log(
                        `  📡 Collateral mapping: name="${c.name}" -> key="${key}" -> owner="${c.neuronId}"`
                    );
                });
            } else {
                console.log('❌ NO COLLATERALS FOUND OR ARRAY IS EMPTY');
            }

            if (allDendrites && allDendrites.length > 0) {
                console.log('🌿 RAW DENDRITES:', allDendrites.slice(0, 3));
                allDendrites.slice(0, 3).forEach(d => {
                    const key = String(d.name).replace(/^.*:collateral:/, '');
                    console.log(
                        `  🌿 Dendrite: neuron="${d.neuronId}" listens to collateral="${d.name}" -> key="${key}"`
                    );
                });
            }

            // First, create static connections from axon ownership
            console.log('🔗 BUILDING CONNECTIONS...');
            dendritesByCollateral.forEach((listeners, coll) => {
                const owner = ownerByCollateral.get(coll);
                console.log(
                    `  🔗 Collateral "${coll}": owner="${owner}", listeners=[${Array.from(
                        listeners
                    ).join(', ')}]`
                );
                if (!owner) {
                    console.log(
                        `    ❌ No owner found for collateral "${coll}"`
                    );
                    return;
                }
                listeners.forEach(target => {
                    if (target === owner) {
                        console.log(
                            `    ⚠️ Self-connection skipped: ${owner} -> ${target} via ${coll}`
                        );
                        return;
                    }
                    const key = edgeKey(owner, target, coll);
                    const prev = edgeMap.get(key);
                    edgeMap.set(key, {
                        from: owner,
                        to: target,
                        label: coll,
                        count: (prev?.count || 0) + 1,
                    });
                    console.log(
                        `    ✅ Added connection: ${owner} -> ${target} via ${coll}`
                    );
                });
            });

            // Then, enhance with response data if available
            if (Array.isArray(allResponses)) {
                for (const r of allResponses) {
                    if (!r) continue;
                    const inColl = (
                        r?.inputCollateralName as string | undefined
                    )?.replace(/^.*:collateral:/, '');
                    const outColl = (
                        r?.outputCollateralName as string | undefined
                    )?.replace(/^.*:collateral:/, '');
                    // Find source neuron by looking up the collateral owner
                    const sourceNeuronId = outColl
                        ? ownerByCollateral.get(outColl)
                        : undefined;
                    // If there is an input collateral, map it to neurons that listen to it (dendrites)
                    if (inColl) {
                        const listeners = dendritesByCollateral.get(inColl);
                        if (listeners && sourceNeuronId) {
                            // r.neuronId is the source neuron that produced output to outColl (or processed input)
                            for (const targetNeuronId of listeners) {
                                if (targetNeuronId !== sourceNeuronId) {
                                    const key = edgeKey(
                                        sourceNeuronId,
                                        targetNeuronId,
                                        inColl
                                    );
                                    const prev = edgeMap.get(key);
                                    edgeMap.set(key, {
                                        from: sourceNeuronId,
                                        to: targetNeuronId,
                                        label: inColl,
                                        count: (prev?.count || 0) + 1,
                                    });
                                }
                            }
                        }
                    }
                    // Also create link via output collateral to any neuron that has dendrite by that collateral
                    if (outColl && sourceNeuronId) {
                        const listeners = dendritesByCollateral.get(outColl);
                        if (listeners) {
                            for (const targetNeuronId of listeners) {
                                if (targetNeuronId !== sourceNeuronId) {
                                    const key = edgeKey(
                                        sourceNeuronId,
                                        targetNeuronId,
                                        outColl
                                    );
                                    const prev = edgeMap.get(key);
                                    edgeMap.set(key, {
                                        from: sourceNeuronId,
                                        to: targetNeuronId,
                                        label: outColl,
                                        count: (prev?.count || 0) + 1,
                                    });
                                }
                            }
                        }
                    }
                }
            }

            console.log('🔍 FINAL CONNECTION DEBUG:', {
                edgeMapSize: edgeMap.size,
                edgeMapEntries: Array.from(edgeMap.entries()).slice(0, 3),
            });

            // Materialize connection list
            edgeMap.forEach(v => {
                graphConnections.push({
                    from: v.from,
                    to: v.to,
                    weight: 0.5,
                    stimulationCount: v.count,
                    label: v.label.replace(/^.*:collateral:/, ''),
                });
            });
            console.log(
                `🎯 FINAL RESULT: Created ${graphConnections.length} connections from ${edgeMap.size} edges`
            );
        }

        console.log('✅ Graph conversion complete:', {
            inputNeurons: allNeurons?.length || 0,
            outputNeurons: graphNeurons.length,
            outputConnections: graphConnections.length,
            firstGraphNeuron: graphNeurons[0],
            conversionConditionsMet: {
                hasAllNeurons: !!allNeurons,
                isArray: Array.isArray(allNeurons),
                hasLength: allNeurons && allNeurons.length > 0,
            },
        });
        return { neurons: graphNeurons, connections: graphConnections };
    }, [allNeurons, allDendrites, allStimulations, allCollaterals]);

    // Persist derived graph data into OIMDB minimal collections (no duplication)
    React.useEffect(() => {
        const appId = effectiveSelectedAppId;
        if (!appId) return;
        if (!realGraphData || !Array.isArray(realGraphData.neurons)) return;

        // Store layouts
        for (const n of realGraphData.neurons) {
            const layoutPk = `${appId}::${n.id}` as `${string}::${string}`;
            db.graphLayouts.collection.upsertOne({
                appId,
                neuronId: n.id,
                x: n.x,
                y: n.y,
                stimulationCount: n.stimulationCount,
            });
            db.graphLayouts.indexes.appId.addPks(appId, [layoutPk]);
        }

        // Store edges
        for (const e of realGraphData.connections) {
            const edgePk = `${appId}::${e.from}->${e.to}::${
                e.label || ''
            }` as `${string}::${string}->${string}::${string}`;
            db.graphEdges.collection.upsertOne({
                appId,
                from: e.from,
                to: e.to,
                label: e.label,
                count: e.stimulationCount,
            });
            db.graphEdges.indexes.appId.addPks(appId, [edgePk]);
        }
    }, [effectiveSelectedAppId, realGraphData]);

    // Additional debug for conversion
    if (allNeurons && allNeurons.length > 0) {
        console.log(
            '🧠 Found neurons, but graph has:',
            realGraphData.neurons.length
        );
        console.log('🔗 Sample neuron:', allNeurons[0]);
        if (allDendrites && allDendrites.length > 0) {
            console.log('🌿 Sample dendrite:', allDendrites[0]);
        }
        if (allResponses && allResponses.length > 0) {
            console.log('⚡ Sample response:', allResponses[0]);
        }
    }

    return (
        <div
            className="no-smooth pixel-perfect"
            style={{
                display: 'flex',
                height: '100vh',
                width: '100vw',
                fontFamily: 'var(--font-primary)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
            }}
        >
            {/* Sidebar with app info */}
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
                    <ContextStoreMonitor
                        selectedAppId={effectiveSelectedAppId}
                    />
                </div>

                {/* Analytics Dashboard */}
                <div style={{ marginBottom: 'var(--spacing-xl)' }}>
                    <AnalyticsDashboard
                        selectedAppId={effectiveSelectedAppId}
                    />
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
                            onClick={() => {
                                console.log('🔄 Refreshing data...');
                                safeSend({ type: 'apps:get-topology' });
                                safeSend({ type: 'apps:list' });
                                safeSend({
                                    type: 'apps:get-responses',
                                    appId: 'all',
                                    limit: 1000,
                                });
                            }}
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
                                e.currentTarget.style.background =
                                    'var(--bg-card)';
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
                                key={app.appId}
                                className={`pulse-infection ${
                                    selectedAppId === app.appId
                                        ? 'decay-glow'
                                        : ''
                                }`}
                                onClick={() => {
                                    setSelectedAppId(app.appId);
                                    // route selection through CNS so data-layer updates indexes
                                    try {
                                        const signal =
                                            appModelAxon.selectAppClicked.createSignal(
                                                { appId: app.appId }
                                            );
                                        mainCNS.stimulate(signal);
                                    } catch {}
                                    navigate(`/apps/${app.appId}`);
                                }}
                                style={{
                                    background:
                                        selectedAppId === app.appId
                                            ? 'var(--flesh-infected)'
                                            : 'var(--bg-card)',
                                    padding: 'var(--spacing-md)',
                                    borderRadius: 'var(--radius-sm)',
                                    marginBottom: 'var(--spacing-sm)',
                                    borderLeft: `4px solid ${
                                        selectedAppId === app.appId
                                            ? 'var(--infection-green)'
                                            : 'var(--infection-red)'
                                    }`,
                                    border: `2px solid ${
                                        selectedAppId === app.appId
                                            ? 'var(--border-infected)'
                                            : 'var(--border-accent)'
                                    }`,
                                    boxShadow:
                                        selectedAppId === app.appId
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
                                    🧠 {app.appName}
                                </div>
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        color: 'var(--text-secondary)',
                                        fontFamily: 'var(--font-primary)',
                                    }}
                                >
                                    {app.appId}
                                </div>
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        color:
                                            selectedAppId === app.appId
                                                ? 'var(--infection-green)'
                                                : 'var(--text-success)',
                                        marginTop: 'var(--spacing-xs)',
                                    }}
                                >
                                    {selectedAppId === app.appId
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
                        {connectionStatus === 'connected' &&
                            '✅ Server Connected'}
                        {connectionStatus === 'connecting' &&
                            '🔄 Connecting...'}
                        {connectionStatus === 'disconnected' &&
                            '❌ Disconnected'}
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
                            {connectedApps?.find(
                                app => app.appId === selectedAppId
                            )?.appName || selectedAppId}
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
                                            setSelectedCnsId(
                                                e.target.value || null
                                            )
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
                        {/* Export filter controls */}
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
                                Export Filters (optional)
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                                <input
                                    placeholder="fromTimestamp"
                                    value={exportFrom}
                                    onChange={e =>
                                        setExportFrom(e.target.value)
                                    }
                                    style={{
                                        fontSize: '10px',
                                        padding: '4px',
                                        background: 'var(--bg-panel)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)',
                                    }}
                                />
                                <input
                                    placeholder="toTimestamp"
                                    value={exportTo}
                                    onChange={e => setExportTo(e.target.value)}
                                    style={{
                                        fontSize: '10px',
                                        padding: '4px',
                                        background: 'var(--bg-panel)',
                                        color: 'var(--text-primary)',
                                        border: '1px solid var(--border-primary)',
                                    }}
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input
                                        placeholder="offset"
                                        value={exportOffset}
                                        onChange={e =>
                                            setExportOffset(e.target.value)
                                        }
                                        style={{
                                            fontSize: '10px',
                                            padding: '4px',
                                            background: 'var(--bg-panel)',
                                            color: 'var(--text-primary)',
                                            border: '1px solid var(--border-primary)',
                                            flex: 1,
                                        }}
                                    />
                                    <input
                                        placeholder="limit"
                                        value={exportLimit}
                                        onChange={e =>
                                            setExportLimit(e.target.value)
                                        }
                                        style={{
                                            fontSize: '10px',
                                            padding: '4px',
                                            background: 'var(--bg-panel)',
                                            color: 'var(--text-primary)',
                                            border: '1px solid var(--border-primary)',
                                            flex: 1,
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
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
                                    <input
                                        placeholder="error contains..."
                                        value={errorContains}
                                        onChange={e =>
                                            setErrorContains(e.target.value)
                                        }
                                        style={{
                                            fontSize: '10px',
                                            padding: '4px',
                                            background: 'var(--bg-panel)',
                                            color: 'var(--text-primary)',
                                            border: '1px solid var(--border-primary)',
                                            flex: 1,
                                        }}
                                    />
                                </div>
                                <button
                                    className="btn-infected"
                                    onClick={() => {
                                        if (!selectedAppId) return;
                                        safeSend({
                                            type: 'apps:get-stimulations',
                                            appId: selectedAppId,
                                            hasError: onlyErrors || undefined,
                                            errorContains:
                                                errorContains || undefined,
                                        });
                                        const cnsIds =
                                            (db.cns.indexes.appId.getPksByKey(
                                                selectedAppId || ''
                                            ) || new Set()) as Set<string>;
                                        const target =
                                            cnsIds.size > 0
                                                ? Array.from(cnsIds)
                                                : selectedAppId
                                                ? [selectedAppId]
                                                : [];
                                        for (const cnsId of target) {
                                            safeSend({
                                                type: 'cns:get-responses',
                                                cnsId,
                                                hasError:
                                                    onlyErrors || undefined,
                                                errorContains:
                                                    errorContains || undefined,
                                            });
                                        }
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
                                    navigate(
                                        `/apps/${effectiveSelectedAppId || ''}`
                                    );
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
                                color: !location.pathname.endsWith(
                                    '/stimulations'
                                )
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
                        {/* Snapshot export button */}
                        {selectedAppId && (
                            <button
                                className="btn-infected"
                                onClick={async () => {
                                    if (!selectedAppId) return;
                                    const filename = `snapshot-${selectedAppId}-${Date.now()}.json`;
                                    const wait = waitForMessageOnce(
                                        msg =>
                                            msg && msg.type === 'apps:snapshot'
                                    );
                                    safeSend({
                                        type: 'apps:export-snapshot',
                                        appId: selectedAppId,
                                        limitResponses:
                                            Number(exportLimit) || 1000,
                                        limitStimulations:
                                            Number(exportLimit) || 1000,
                                    });
                                    const resp = await wait;
                                    downloadJson(resp, filename);
                                    try {
                                        const size = (resp as any)
                                            ?.sizeBytes as number | undefined;
                                        if (typeof size === 'number') {
                                            setLastSnapshotSize(size);
                                        }
                                        const warn = (resp as any)?.warning as
                                            | string
                                            | undefined;
                                        setLastSnapshotWarning(warn || '');
                                    } catch {}
                                }}
                                disabled={connectionStatus !== 'connected'}
                                style={{
                                    width: '100%',
                                    fontSize: 'var(--font-size-xs)',
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--flesh-medium)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-primary)',
                                }}
                            >
                                ⬇️ Download Snapshot JSON
                            </button>
                        )}
                        {(lastSnapshotSize !== null || lastSnapshotWarning) && (
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '10px',
                                    color: 'var(--text-secondary)',
                                }}
                            >
                                {lastSnapshotSize !== null && (
                                    <span
                                        style={{
                                            color:
                                                lastSnapshotSize < 1_000_000
                                                    ? 'var(--text-success)'
                                                    : lastSnapshotSize <
                                                      5_000_000
                                                    ? 'var(--text-warning)'
                                                    : 'var(--text-error)',
                                        }}
                                    >
                                        📦 {Math.round(lastSnapshotSize / 1024)}{' '}
                                        KB
                                    </span>
                                )}
                                {lastSnapshotWarning && (
                                    <span
                                        style={{ color: 'var(--text-warning)' }}
                                    >
                                        ⚠️ {lastSnapshotWarning}
                                    </span>
                                )}
                            </div>
                        )}
                        {/* Export buttons */}
                        <button
                            className="btn-infected"
                            onClick={handleExportTopology}
                            disabled={connectionStatus !== 'connected'}
                            style={{
                                width: '100%',
                                fontSize: 'var(--font-size-xs)',
                                padding: 'var(--spacing-sm)',
                                background: 'var(--flesh-medium)',
                                color: 'var(--text-secondary)',
                                borderColor: 'var(--border-primary)',
                            }}
                        >
                            ⬇️ Download Topology JSON
                        </button>
                        {selectedAppId && (
                            <button
                                className="btn-infected"
                                onClick={handleExportStimulations}
                                disabled={connectionStatus !== 'connected'}
                                style={{
                                    width: '100%',
                                    fontSize: 'var(--font-size-xs)',
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--flesh-medium)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-primary)',
                                }}
                            >
                                ⬇️ Download Stimulations JSON
                            </button>
                        )}
                        {selectedAppId && (
                            <button
                                className="btn-infected"
                                onClick={async () => {
                                    if (!selectedAppId) return;
                                    const filename = `stimulations-errors-${selectedAppId}-${Date.now()}.json`;
                                    const wait = waitForMessageOnce(
                                        msg =>
                                            msg &&
                                            msg.type ===
                                                'apps:export-stimulations'
                                    );
                                    safeSend({
                                        type: 'apps:export-stimulations',
                                        appId: selectedAppId,
                                        hasError: true,
                                        errorContains:
                                            errorContains || undefined,
                                        limit: Number(exportLimit) || 1000,
                                    });
                                    const resp = await wait;
                                    downloadJson(resp, filename);
                                }}
                                disabled={connectionStatus !== 'connected'}
                                style={{
                                    width: '100%',
                                    fontSize: 'var(--font-size-xs)',
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--flesh-medium)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-primary)',
                                }}
                            >
                                ⬇️ Export Stimulations (Errors Only)
                            </button>
                        )}
                        {(selectedCnsId || selectedAppId) && (
                            <button
                                className="btn-infected"
                                onClick={handleExportResponses}
                                disabled={connectionStatus !== 'connected'}
                                style={{
                                    width: '100%',
                                    fontSize: 'var(--font-size-xs)',
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--flesh-medium)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-primary)',
                                }}
                            >
                                ⬇️ Download Responses JSON
                            </button>
                        )}
                        {(selectedCnsId || selectedAppId) && (
                            <button
                                className="btn-infected"
                                onClick={async () => {
                                    const cnsId =
                                        selectedCnsId || selectedAppId;
                                    if (!cnsId) return;
                                    const filename = `responses-errors-${cnsId}-${Date.now()}.json`;
                                    const wait = waitForMessageOnce(
                                        msg =>
                                            msg &&
                                            msg.type === 'cns:export-responses'
                                    );
                                    safeSend({
                                        type: 'cns:export-responses',
                                        cnsId,
                                        hasError: true,
                                        errorContains:
                                            errorContains || undefined,
                                        limit: Number(exportLimit) || 1000,
                                    });
                                    const resp = await wait;
                                    downloadJson(resp, filename);
                                }}
                                disabled={connectionStatus !== 'connected'}
                                style={{
                                    width: '100%',
                                    fontSize: 'var(--font-size-xs)',
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--flesh-medium)',
                                    color: 'var(--text-secondary)',
                                    borderColor: 'var(--border-primary)',
                                }}
                            >
                                ⬇️ Export Responses (Errors Only)
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Main content area */}
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg-primary)',
                    border: `1px solid var(--border-primary)`,
                    overflow: 'hidden',
                }}
            >
                {location.pathname.endsWith('/stimulations') ? (
                    <StimulationsPage
                        appId={effectiveSelectedAppId || ''}
                        wsRef={wsRef}
                        cnsId={selectedCnsId}
                    />
                ) : (
                    <>
                        {realGraphData.neurons.length > 0 ? (
                            <>
                                {/* Sticky stats bar above the graph */}
                                <div
                                    style={{
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 5,
                                        background: 'var(--bg-panel)',
                                        borderBottom:
                                            '1px solid var(--border-infected)',
                                        padding: '8px 12px',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: '16px',
                                            alignItems: 'center',
                                            fontSize: 'var(--font-size-xs)',
                                            color: 'var(--text-secondary)',
                                        }}
                                    >
                                        <span>🗺️ Network Map</span>
                                        <span
                                            style={{
                                                color: 'var(--infection-green)',
                                            }}
                                        >
                                            🧠 {realGraphData.neurons.length}{' '}
                                            neurons
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--infection-green)',
                                            }}
                                        >
                                            🔗{' '}
                                            {realGraphData.connections.length}{' '}
                                            connections
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--text-secondary)',
                                            }}
                                        >
                                            ⚡{' '}
                                            <span
                                                data-testid="stats-stimulations"
                                                className="stats-stimulations"
                                            >
                                                {allStimulations?.length || 0}
                                            </span>{' '}
                                            stimulations
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--text-secondary)',
                                            }}
                                        >
                                            📨{' '}
                                            <span
                                                data-testid="stats-responses"
                                                className="stats-responses"
                                            >
                                                {allResponses?.length || 0}
                                            </span>{' '}
                                            responses
                                        </span>
                                        {selectedAppId && (
                                            <span>
                                                📱{' '}
                                                {connectedApps?.find(
                                                    a =>
                                                        a.appId ===
                                                        selectedAppId
                                                )?.appName || 'Unknown'}
                                            </span>
                                        )}
                                        {selectedNeuron && (
                                            <span
                                                style={{
                                                    color: 'var(--infection-red)',
                                                }}
                                            >
                                                🎯 {selectedNeuron.name}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Graph region */}
                                <div
                                    style={{
                                        flex: 1,
                                        position: 'relative',
                                        overflow: 'hidden',
                                    }}
                                >
                                    <CNSGraph
                                        neurons={realGraphData.neurons}
                                        connections={realGraphData.connections}
                                        onNeuronClick={handleNeuronClick}
                                    />

                                    {/* Clear selection button */}
                                    {selectedNeuron && (
                                        <button
                                            className="clear-selection-btn"
                                            onClick={handleCloseNeuronDetails}
                                            title="Clear neuron selection"
                                        >
                                            ✕ Clear Selection
                                        </button>
                                    )}

                                    {/* Neuron Details Panel */}
                                    <NeuronDetailsPanel
                                        neuronId={selectedNeuron?.id || ''}
                                        onClose={handleCloseNeuronDetails}
                                        appId={
                                            effectiveSelectedAppId || undefined
                                        }
                                    />
                                </div>
                            </>
                        ) : (
                            <EmptyGraphPlaceholder
                                message={
                                    selectedAppId
                                        ? '📊 No Network Data'
                                        : '📱 Select Application'
                                }
                                submessage={
                                    selectedAppId
                                        ? 'Network topology is empty. Make sure your application is creating neurons and stimulations.'
                                        : 'Choose an application from the sidebar to view its neural network topology.'
                                }
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
