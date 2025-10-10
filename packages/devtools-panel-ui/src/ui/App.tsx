import React, {
    useEffect,
    useRef,
    useMemo,
    useLayoutEffect,
    useState,
} from 'react';
import * as PIXI from 'pixi.js';
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
}

interface ConnectionData {
    from: string;
    to: string;
    weight: number;
    stimulationCount: number;
    label?: string;
}

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
    }, [selectedCnsId, selectedAppId, waitForMessageOnce, downloadJson]);

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

    useEffect(() => {
        // Initialize data limiter
        // dataLimiter.startCleanup();

        const url =
            (window as any).__CNSTRA_DEVTOOLS_WS__ || 'ws://localhost:8080';
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener('open', () => {
            console.log('🔗 Connected to DevTools server');
            setConnectionStatus('connected');

            // Identify as DevTools client
            ws.send(JSON.stringify({ type: 'devtools-client-connect' }));

            // Request topology data for any already-connected apps
            console.log('📡 Requesting topology data...');
            ws.send(JSON.stringify({ type: 'apps:get-topology' }));

            // Request apps list (REST-over-WS)
            console.log('📡 Requesting apps list...');
            ws.send(JSON.stringify({ type: 'apps:list' }));

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
        });

        ws.addEventListener('error', () => {
            console.error('❌ DevTools WebSocket error');
            setConnectionStatus('disconnected');
            mainCNS.stimulate(
                wsAxon.error.createSignal({ message: 'ws error' })
            );
        });

        return () => {
            ws.close();
            wsRef.current = null;
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

    // CNS list for selected app
    const cnsIdsForApp = React.useMemo(() => {
        if (!selectedAppId) return [] as string[];
        const pks = (db.cns.indexes.appId.getPksByKey(selectedAppId) ||
            new Set()) as Set<string>;
        return Array.from(pks);
    }, [selectedAppId]);

    // Request stimulations when apps are connected
    useEffect(() => {
        if (
            connectedApps &&
            connectedApps.length > 0 &&
            wsRef.current &&
            wsRef.current.readyState === WebSocket.OPEN
        ) {
            console.log(
                '🧠 Requesting stimulations for',
                connectedApps.length,
                'apps'
            );
            connectedApps.forEach(app => {
                console.log('🧠 Requesting stimulations for app:', app.appId);
                wsRef.current!.send(
                    JSON.stringify({
                        type: 'apps:get-stimulations',
                        appId: app.appId,
                    })
                );
            });
        }
    }, [connectedApps]);

    // Proactive short polling on graph: ensure stimulations arrive without visiting the Stimulations page
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!connectedApps || connectedApps.length === 0) return;
        let isCancelled = false;
        const startedAt = Date.now();
        const tick = () => {
            if (isCancelled) return;
            try {
                connectedApps.forEach(app => {
                    ws.send(
                        JSON.stringify({
                            type: 'apps:get-stimulations',
                            appId: app.appId,
                            limit: 1000,
                        })
                    );
                });
            } catch {}
            const elapsed = Date.now() - startedAt;
            if (elapsed < 10_000) setTimeout(tick, 1000);
        };
        // kick off immediately
        tick();
        return () => {
            isCancelled = true;
        };
    }, [connectedApps, wsRef.current]);

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

    // Fetch topology and data for selected app/CNS via REST-over-WS
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!selectedAppId) return;

        // Request CNS list for the selected app (do not assume 1:1 mapping)
        try {
            ws.send(
                JSON.stringify({ type: 'apps:get-cns', appId: selectedAppId })
            );
        } catch {}

        // If CNS list already known in DB, fetch for all, else fallback to selectedAppId-as-cnsId for backward compat
        try {
            const cnsIds = (db.cns.indexes.appId.getPksByKey(selectedAppId) ||
                new Set()) as Set<string>;
            const targetCnsIds =
                cnsIds.size > 0 ? Array.from(cnsIds) : [selectedAppId];
            for (const cnsId of targetCnsIds) {
                ws.send(JSON.stringify({ type: 'cns:get-neurons', cnsId }));
                ws.send(JSON.stringify({ type: 'cns:get-dendrites', cnsId }));
                ws.send(JSON.stringify({ type: 'cns:get-collaterals', cnsId }));
                ws.send(
                    JSON.stringify({
                        type: 'cns:get-responses',
                        cnsId,
                        limit: 1000,
                    })
                );
            }
            ws.send(
                JSON.stringify({
                    type: 'apps:get-stimulations',
                    appId: selectedAppId,
                    limit: 1000,
                })
            );
        } catch {}
    }, [selectedAppId, selectedCnsId]);

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

    // Filter out data when no app is selected
    const allNeurons = effectiveSelectedAppId ? allNeuronsRaw : null;
    const allDendrites = effectiveSelectedAppId ? allDendritesRaw : null;
    const allResponses = effectiveSelectedAppId ? allResponsesRaw : null;
    const allStimulations = effectiveSelectedAppId ? allStimulationsRaw : null;
    const allCollaterals = effectiveSelectedAppId ? allCollateralsRaw : null;

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
        sampleResponseNeuronIds: allResponses?.slice(0, 3).map(r => r.neuronId),
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
                stimulationId: s.stimulationId,
                appId: s.appId,
                neuronId: s.neuronId,
                collateralName: s.collateralName,
            })),
        allStimulationsDebug: allStimulations?.map(s => ({
            stimulationId: s.stimulationId,
            neuronId: s.neuronId,
            collateralName: s.collateralName,
        })),
        dbDendritesSample: db.dendrites
            .getAll()
            .slice(0, 3)
            .map(d => ({
                id: d.dendriteId,
                appId: d.appId,
                neuronId: d.neuronId,
                collateralName: d.collateralName,
            })),
        allStimulationsAppIds: db.stimulations
            .getAll()
            .slice(0, 10)
            .map(s => s.appId),
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
            // Debug: Log available response neuron IDs vs current neuron ID
            const responseNeuronIds = Array.isArray(allResponses)
                ? [...new Set(allResponses.map(r => r.neuronId))]
                : [];

            console.log(
                `🔍 Neuron "${neuron.name}" (id: "${neuron.id}") vs response neuronIds:`,
                responseNeuronIds
            );

            // Compute response count for this neuron from responses (both input and output)
            // Handle neuronId format mismatch: some responses use short IDs ('auth-service')
            // while neurons use full IDs ('ecommerce-app:auth-service')
            const extractShortNeuronId = (fullId: string) =>
                fullId.split(':').pop() || fullId;
            const shortNeuronId = extractShortNeuronId(neuron.id);

            // Count responses FROM this neuron (where neuronId = this neuron in responses)
            const outgoingResponses = Array.isArray(allResponses)
                ? allResponses.filter(
                      r =>
                          r.neuronId === neuron.id || // exact match
                          r.neuronId === shortNeuronId || // short ID match
                          extractShortNeuronId(r.neuronId) === shortNeuronId // both normalized
                  )
                : [];

            // Count responses TO this neuron via stimulations this neuron received
            // First find stimulations that were sent to this neuron via its input collaterals
            const neuronDendrites = Array.isArray(allDendrites)
                ? allDendrites.filter(
                      d =>
                          d.neuronId === neuron.id ||
                          d.neuronId === shortNeuronId ||
                          extractShortNeuronId(d.neuronId) === shortNeuronId
                  )
                : [];

            const listenedCollaterals = neuronDendrites.map(
                d => d.collateralName
            );

            // Find stimulations sent to this neuron
            const incomingStimulations = Array.isArray(allStimulations)
                ? allStimulations.filter(s =>
                      listenedCollaterals.some(
                          colName =>
                              s.collateralName === colName ||
                              s.collateralName ===
                                  colName.replace(/^.*:collateral:/, '') ||
                              colName.includes(s.collateralName)
                      )
                  )
                : [];

            // Find responses to those incoming stimulations (responses by this neuron to signals it received)
            const incomingResponses = Array.isArray(allResponses)
                ? allResponses.filter(r =>
                      incomingStimulations.some(
                          stim => stim.stimulationId === r.stimulationId
                      )
                  )
                : [];

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
                console.log(`   Dendrites found: ${neuronDendrites.length}`);
                console.log(
                    `   Listened collaterals: [${listenedCollaterals.join(
                        ', '
                    )}]`
                );

                if (Array.isArray(allStimulations)) {
                    const uniqueStimCollaterals = [
                        ...new Set(allStimulations.map(s => s.collateralName)),
                    ];
                    console.log(
                        `   Available stimulation collaterals: [${uniqueStimCollaterals.join(
                            ', '
                        )}]`
                    );

                    // Test each matching condition
                    listenedCollaterals.forEach(colName => {
                        const exactMatches = allStimulations.filter(
                            s => s.collateralName === colName
                        );
                        const cleanMatches = allStimulations.filter(
                            s =>
                                s.collateralName ===
                                colName.replace(/^.*:collateral:/, '')
                        );
                        const includesMatches = allStimulations.filter(s =>
                            colName.includes(s.collateralName)
                        );
                        console.log(
                            `   Collateral "${colName}": exact=${exactMatches.length}, clean=${cleanMatches.length}, includes=${includesMatches.length}`
                        );
                    });
                }
            }

            // Debug: Show which neuron has stimulations and the ID mapping
            if (responseCount > 0) {
                console.log(
                    `💥 NEURON WITH RESPONSES: ${neuron.name} (${neuron.id}) -> shortId: ${shortNeuronId} -> ${responseCount} total responses`
                );
                console.log(
                    `   📤 Outgoing responses: ${outgoingResponses.length}, 📥 Incoming responses: ${incomingResponses.length}, 🔄 Unique responses: ${uniqueResponses.length}`
                );
                console.log(
                    `   🎯 Listens to collaterals: [${listenedCollaterals.join(
                        ', '
                    )}]`
                );
            } else {
                // For neurons with 0 responses, check what response neuronIds actually exist
                const responseNeuronIds = Array.isArray(allResponses)
                    ? [...new Set(allResponses.map(r => r.neuronId))]
                    : [];
                console.log(
                    `⚫ NEURON NO RESPONSES: ${neuron.name} (${neuron.id}) -> shortId: ${shortNeuronId} -> ${responseCount} responses`
                );
                console.log(
                    `   📤 Outgoing: ${outgoingResponses.length}, 📥 Incoming: ${incomingResponses.length}`
                );
                console.log(
                    `   🎯 Listens to collaterals: [${listenedCollaterals.join(
                        ', '
                    )}]`
                );
                console.log(
                    `   Available response neuronIds: [${responseNeuronIds.join(
                        ', '
                    )}]`
                );
                console.log(
                    `   Looking for matches with: "${neuron.id}", "${shortNeuronId}"`
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

            const graphNeuron = {
                id: neuron.id,
                name: neuron.name,
                x: x,
                y: y,
                stimulationCount: responseCount,
                stimulations:
                    incomingStimulations.length > 0
                        ? incomingStimulations
                              .slice(0, 10)
                              .map((stimulation: any) => ({
                                  id: stimulation.stimulationId,
                                  timestamp: stimulation.timestamp,
                                  signal: {
                                      type: 'stimulation',
                                      collateral: stimulation.collateralName,
                                      payload: stimulation.payload,
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
                const key = String(d.collateralName).replace(
                    /^.*:collateral:/,
                    ''
                );
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

                    // Use 'name' field instead of 'collateralName' for the stored collateral entities
                    const key = String(
                        collateral.name || collateral.collateralName
                    ).replace(/^.*:collateral:/, '');
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
                    const key = String(c.collateralName).replace(
                        /^.*:collateral:/,
                        ''
                    );
                    console.log(
                        `  📡 Collateral mapping: name="${c.collateralName}" -> key="${key}" -> owner="${c.neuronId}"`
                    );
                });
            } else {
                console.log('❌ NO COLLATERALS FOUND OR ARRAY IS EMPTY');
            }

            if (allDendrites && allDendrites.length > 0) {
                console.log('🌿 RAW DENDRITES:', allDendrites.slice(0, 3));
                allDendrites.slice(0, 3).forEach(d => {
                    const key = String(d.collateralName).replace(
                        /^.*:collateral:/,
                        ''
                    );
                    console.log(
                        `  🌿 Dendrite: neuron="${d.neuronId}" listens to collateral="${d.collateralName}" -> key="${key}"`
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
                    const inColl = (
                        r.inputCollateralName as string | undefined
                    )?.replace(/^.*:collateral:/, '');
                    const outColl = (
                        r.outputCollateralName as string | undefined
                    )?.replace(/^.*:collateral:/, '');
                    const sourceNeuronId = r.neuronId as string | undefined;
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
                    <h3
                        style={{
                            margin: `0 0 var(--spacing-md) 0`,
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                            letterSpacing: '1px',
                        }}
                    >
                        📱 CONNECTED APPS ({connectedApps?.length || 0})
                    </h3>
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
                                        const ws = wsRef.current;
                                        if (
                                            !ws ||
                                            ws.readyState !== WebSocket.OPEN
                                        )
                                            return;
                                        try {
                                            ws.send(
                                                JSON.stringify({
                                                    type: 'apps:get-stimulations',
                                                    appId: selectedAppId,
                                                    hasError:
                                                        onlyErrors || undefined,
                                                    errorContains:
                                                        errorContains ||
                                                        undefined,
                                                })
                                            );
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
                                                ws.send(
                                                    JSON.stringify({
                                                        type: 'cns:get-responses',
                                                        cnsId,
                                                        hasError:
                                                            onlyErrors ||
                                                            undefined,
                                                        errorContains:
                                                            errorContains ||
                                                            undefined,
                                                    })
                                                );
                                            }
                                        } catch {}
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
                                    const ws = wsRef.current;
                                    if (!ws || ws.readyState !== WebSocket.OPEN)
                                        return;
                                    const filename = `snapshot-${selectedAppId}-${Date.now()}.json`;
                                    const wait = waitForMessageOnce(
                                        msg =>
                                            msg && msg.type === 'apps:snapshot'
                                    );
                                    ws.send(
                                        JSON.stringify({
                                            type: 'apps:export-snapshot',
                                            appId: selectedAppId,
                                            limitResponses:
                                                Number(exportLimit) || 1000,
                                            limitStimulations:
                                                Number(exportLimit) || 1000,
                                        })
                                    );
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
                                    const ws = wsRef.current;
                                    if (!ws || ws.readyState !== WebSocket.OPEN)
                                        return;
                                    const appId = selectedAppId;
                                    const filename = `stimulations-errors-${appId}-${Date.now()}.json`;
                                    const wait = waitForMessageOnce(
                                        msg =>
                                            msg &&
                                            msg.type ===
                                                'apps:export-stimulations'
                                    );
                                    ws.send(
                                        JSON.stringify({
                                            type: 'apps:export-stimulations',
                                            appId,
                                            hasError: true,
                                            errorContains:
                                                errorContains || undefined,
                                            limit: Number(exportLimit) || 1000,
                                        })
                                    );
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
                                    const ws = wsRef.current;
                                    if (!ws || ws.readyState !== WebSocket.OPEN)
                                        return;
                                    const cnsId =
                                        selectedCnsId || selectedAppId;
                                    const filename = `responses-errors-${cnsId}-${Date.now()}.json`;
                                    const wait = waitForMessageOnce(
                                        msg =>
                                            msg &&
                                            msg.type === 'cns:export-responses'
                                    );
                                    ws.send(
                                        JSON.stringify({
                                            type: 'cns:export-responses',
                                            cnsId,
                                            hasError: true,
                                            errorContains:
                                                errorContains || undefined,
                                            limit: Number(exportLimit) || 1000,
                                        })
                                    );
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
                                            ⚡ {allStimulations?.length || 0}{' '}
                                            stimulations
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
                                        appId={selectedAppId || undefined}
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
