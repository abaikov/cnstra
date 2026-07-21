import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../model';
import CNSGraph from './CNSGraph';
import { FrontierData, computeFrontier } from './frontier';
import NeuronDetailsPanel from './NeuronDetailsPanel';
import EmptyGraphPlaceholder from './EmptyGraphPlaceholder';
import {
    useSelectEntitiesByIndexKeySetBased,
    useSelectEntityByPk,
} from '@oimdb/react';

// Resolve a collateral's display name from its id (dendrites/hops now reference
// collaterals by id, not by name).
const collateralName = (
    collateralId: string | null | undefined
): string | undefined =>
    collateralId ? db.collaterals.getOneByPk(collateralId)?.name : undefined;

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

interface TopologyViewProps {
    appId: string | null;
    cnsId: string | null;
}

export const TopologyView: React.FC<TopologyViewProps> = ({ appId }) => {
    const [selectedNeuron, setSelectedNeuron] = useState<NeuronData | null>(
        null
    );

    // Handle neuron click
    const handleNeuronClick = (neuron: NeuronData) => {
        setSelectedNeuron(neuron);
    };

    // Handle closing neuron details panel
    const handleCloseNeuronDetails = () => {
        setSelectedNeuron(null);
    };

    // App entity (for the stats header name label)
    const selectedApp = useSelectEntityByPk(db.apps, appId || 'dummy-id');

    // Always call hooks unconditionally (Rules of Hooks)
    const allNeuronsRaw = useSelectEntitiesByIndexKeySetBased(
        db.neurons,
        db.neurons.indexes.appId,
        appId || 'dummy-id' // Use dummy ID when no app selected
    );

    const allDendritesRaw = useSelectEntitiesByIndexKeySetBased(
        db.dendrites,
        db.dendrites.indexes.appId,
        appId || 'dummy-id'
    );

    const allResponsesRaw = useSelectEntitiesByIndexKeySetBased(
        db.responses,
        db.responses.indexes.appId,
        appId || 'dummy-id'
    );

    const allStimulationsRaw = useSelectEntitiesByIndexKeySetBased(
        db.stimulations,
        db.stimulations.indexes.appId,
        appId || 'dummy-id'
    );

    const allCollateralsRaw = useSelectEntitiesByIndexKeySetBased(
        db.collaterals,
        db.collaterals.indexes.appId,
        appId || 'dummy-id'
    );

    // Filter out data when no app is selected and undefined elements
    const allNeurons = appId
        ? (allNeuronsRaw || []).filter(
              (n): n is NonNullable<typeof n> => n != null
          )
        : null;
    const allDendrites = appId
        ? (allDendritesRaw || []).filter(
              (d): d is NonNullable<typeof d> => d != null
          )
        : null;
    const allResponses = appId
        ? (allResponsesRaw || []).filter(
              (r): r is NonNullable<typeof r> => r != null
          )
        : null;
    const allStimulations = appId
        ? (allStimulationsRaw || []).filter(
              (s): s is NonNullable<typeof s> => s != null
          )
        : null;
    const allCollaterals = appId
        ? (allCollateralsRaw || []).filter(
              (c): c is NonNullable<typeof c> => c != null
          )
        : null;

    // Expose counts for E2E assertions
    useEffect(() => {
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

    // Convert real database data to graph format using useMemo
    const realGraphData = useMemo((): {
        neurons: NeuronData[];
        connections: ConnectionData[];
    } => {
        // Check if we have valid neuron data
        if (
            !allNeurons ||
            !Array.isArray(allNeurons) ||
            allNeurons.length === 0
        ) {
            return { neurons: [], connections: [] };
        }

        // Create neuron nodes
        const graphNeurons: NeuronData[] = allNeurons.map((neuron, index) => {
            // Compute response count for this neuron from responses
            // Find responses where this neuron is the output (via collaterals)
            const neuronCollateralNames = allCollaterals
                ?.filter(c => c.neuronId === neuron.id)
                .map(c => c.name);

            const outgoingResponses = Array.isArray(allResponses)
                ? allResponses.filter(r => {
                      const outName = collateralName(r.outputCollateralId);
                      if (!r || !neuronCollateralNames || !outName)
                          return false;
                      return neuronCollateralNames.includes(outName);
                  })
                : [];

            // Find responses where this neuron is the input (via dendrites).
            // Dendrites reference collaterals by id; resolve to the name.
            const neuronDendriteNames = allDendrites
                ?.filter(d => d.neuronId === neuron.id)
                .map(d => collateralName(d.collateralId))
                .filter((n): n is string => Boolean(n));

            const incomingResponses = Array.isArray(allResponses)
                ? allResponses.filter(r => {
                      const inName = collateralName(r.inputCollateralId);
                      if (!r || !neuronDendriteNames || !inName) return false;
                      return neuronDendriteNames.includes(inName);
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
                    arr.findIndex(r => r.id === resp.id) === index
            );
            const responseCount = uniqueResponses.length;

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
                                  id: response.id,
                                  timestamp: response.startedAt,
                                  signal: {
                                      type: 'response',
                                      inputCollateral: collateralName(
                                          response?.inputCollateralId
                                      ),
                                      outputCollateral: collateralName(
                                          response?.outputCollateralId
                                      ),
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

            return graphNeuron;
        });

        // Build real connections using dendrites:
        // each dendrite belongs to a neuron and references a collateral.
        // If any response shows this collateral as input -> output between two neurons,
        // connect source neuron -> dendrite.neuronId and label by collateral name.
        const graphConnections: ConnectionData[] = [];
        if (Array.isArray(allDendrites) && allDendrites.length > 0) {
            // Index dendrites by collateral id and neuron
            const dendritesByCollateral = new Map<string, Set<string>>(); // collateralId -> set(neuronId)
            allDendrites.forEach(d => {
                const key = d.collateralId;
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
            const ownerByCollateral = new Map<string, string>(); // collateralId -> owner neuronId
            if (Array.isArray(allCollaterals)) {
                allCollaterals.forEach(collateral => {
                    // Skip collaterals with invalid neuronIds (temporary fix for data consistency issue)
                    if (
                        collateral.neuronId === 'unknown' ||
                        !collateral.neuronId
                    ) {
                        return;
                    }

                    // Key by collateral id (dendrites/hops reference collaterals by id)
                    ownerByCollateral.set(collateral.id, collateral.neuronId);
                });
            }

            // First, create static connections from axon ownership
            dendritesByCollateral.forEach((listeners, coll) => {
                const owner = ownerByCollateral.get(coll);
                if (!owner) {
                    return;
                }
                listeners.forEach(target => {
                    if (target === owner) {
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
                });
            });

            // Then, enhance with response data if available
            if (Array.isArray(allResponses)) {
                for (const r of allResponses) {
                    if (!r) continue;
                    const inColl = r?.inputCollateralId || undefined;
                    const outColl = r?.outputCollateralId || undefined;
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

            // Materialize connection list
            edgeMap.forEach(v => {
                graphConnections.push({
                    from: v.from,
                    to: v.to,
                    weight: 0.5,
                    stimulationCount: v.count,
                    // v.label holds a collateral id; resolve to its display name.
                    label: collateralName(v.label) || v.label,
                });
            });
        }

        return { neurons: graphNeurons, connections: graphConnections };
    }, [allNeurons, allDendrites, allStimulations, allCollaterals]);

    // Live frontier: for each *running* stimulation, the neurons that its hops'
    // output collaterals point at but which haven't produced a hop yet — i.e.
    // what's about to run, known purely from topology + the last hops. Elements
    // that linger here (their hop never arrives) age into a "stuck" state in the
    // graph, which is exactly how a stalled step surfaces visually.
    const frontier = useMemo((): FrontierData => {
        if (
            !appId ||
            !Array.isArray(allResponses) ||
            !Array.isArray(allStimulations) ||
            !Array.isArray(allDendrites)
        ) {
            return { neurons: {}, edges: {} };
        }
        return computeFrontier({
            hops: allResponses,
            stimulations: allStimulations,
            dendrites: allDendrites,
            collaterals: allCollaterals || [],
            now: Date.now(),
        });
    }, [appId, allResponses, allStimulations, allDendrites, allCollaterals]);

    // Persist derived graph data into OIMDB minimal collections (no duplication)
    useEffect(() => {
        if (!appId) return;
        if (!realGraphData || !Array.isArray(realGraphData.neurons)) return;

        // Store layouts (indexes are derived — no manual index writes needed).
        for (const n of realGraphData.neurons) {
            db.graphLayouts.upsertOne({
                appId,
                neuronId: n.id,
                x: n.x,
                y: n.y,
                stimulationCount: n.stimulationCount,
            });
        }

        // Store edges
        for (const e of realGraphData.connections) {
            db.graphEdges.upsertOne({
                appId,
                from: e.from,
                to: e.to,
                label: e.label,
                count: e.stimulationCount,
            });
        }
    }, [appId, realGraphData]);

    if (realGraphData.neurons.length === 0) {
        return (
            <EmptyGraphPlaceholder
                message={appId ? '📊 No Network Data' : '📱 Select Application'}
                submessage={
                    appId
                        ? 'Network topology is empty. Make sure your application is creating neurons and stimulations.'
                        : 'Choose an application from the sidebar to view its neural network topology.'
                }
            />
        );
    }

    return (
        <>
            {/* Sticky stats bar above the graph */}
            <div
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 5,
                    background: 'var(--bg-panel)',
                    borderBottom: '1px solid var(--border-infected)',
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
                        🧠 {realGraphData.neurons.length} neurons
                    </span>
                    <span
                        style={{
                            color: 'var(--infection-green)',
                        }}
                    >
                        🔗 {realGraphData.connections.length} connections
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
                    {appId && (
                        <span>📱 {selectedApp?.name || 'Unknown'}</span>
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
                    frontier={frontier}
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
                    appId={appId || undefined}
                />
            </div>
        </>
    );
};

export default TopologyView;
