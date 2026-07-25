import type { TExoSchema } from '@exodra/core';
import { bindable, derive } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';
import { reactIsland } from '@exodra/react';
import { combine, readEntitiesByIndexKey } from '@oimdb/exodra';
import { db } from '../model';
import { cnsGraph } from './CNSGraph';
import { FrontierData, computeFrontier } from './frontier';
import NeuronDetailsPanel from './NeuronDetailsPanel';
import { emptyGraphPlaceholder } from './EmptyGraphPlaceholder';

// Native Exodra port of the topology view. The container (data selection,
// graph-data transform, frontier, stats bar, selection state) is native; the
// three heavy children — CNSGraph (cytoscape), NeuronDetailsPanel, and
// EmptyGraphPlaceholder — are still React, hosted as @exodra/react islands.

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

interface GraphSets {
    allNeurons: any[];
    allDendrites: any[];
    allResponses: any[];
    allCollaterals: any[];
}

// Pure transform (unchanged from the React useMemo) — real DB data → graph.
function buildGraphData({
    allNeurons,
    allDendrites,
    allResponses,
    allCollaterals,
}: GraphSets): { neurons: NeuronData[]; connections: ConnectionData[] } {
    if (!allNeurons || !Array.isArray(allNeurons) || allNeurons.length === 0) {
        return { neurons: [], connections: [] };
    }

    const graphNeurons: NeuronData[] = allNeurons.map((neuron, index) => {
        const neuronCollateralNames = allCollaterals
            ?.filter(c => c.neuronId === neuron.id)
            .map(c => c.name);

        const outgoingResponses = Array.isArray(allResponses)
            ? allResponses.filter(r => {
                  const outName = collateralName(r.outputCollateralId);
                  if (!r || !neuronCollateralNames || !outName) return false;
                  return neuronCollateralNames.includes(outName);
              })
            : [];

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

        const allRelevantResponses = [...outgoingResponses, ...incomingResponses];
        const uniqueResponses = allRelevantResponses.filter(
            (resp, i, arr) => arr.findIndex(r => r.id === resp.id) === i
        );
        const responseCount = uniqueResponses.length;

        const canvasWidth = 800;
        const canvasHeight = 600;
        const spiralRadius = 120;
        const spiralSpacing = 25;
        const angle = index * 2.4 + index * 0.3;
        const radius = spiralRadius + index * spiralSpacing * 0.8;

        let x = canvasWidth / 2 + Math.cos(angle) * radius;
        let y = canvasHeight / 2 + Math.sin(angle) * radius * 0.7;
        const randomOffset = 25;
        x += Math.sin(index * 7.3) * randomOffset;
        y += Math.cos(index * 5.7) * randomOffset;
        const padding = 60;
        x = Math.max(padding, Math.min(canvasWidth - padding, x));
        y = Math.max(padding, Math.min(canvasHeight - padding, y));

        const errorCount = uniqueResponses.filter((r: any) => r?.error).length;
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

        return {
            id: neuron.id,
            name: neuron.name,
            x,
            y,
            stimulationCount: responseCount,
            responseCount: uniqueResponses.length,
            errorCount,
            avgDuration,
            stimulations:
                incomingResponses.length > 0
                    ? incomingResponses.slice(0, 10).map((response: any) => ({
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
    });

    const graphConnections: ConnectionData[] = [];
    if (Array.isArray(allDendrites) && allDendrites.length > 0) {
        const dendritesByCollateral = new Map<string, Set<string>>();
        allDendrites.forEach(d => {
            const key = d.collateralId;
            const set = dendritesByCollateral.get(key) || new Set<string>();
            set.add(d.neuronId);
            dendritesByCollateral.set(key, set);
        });

        const edgeKey = (from: string, to: string, label: string) =>
            `${from}->${to}::${label}`;
        const edgeMap = new Map<
            string,
            { from: string; to: string; label: string; count: number }
        >();

        const ownerByCollateral = new Map<string, string>();
        if (Array.isArray(allCollaterals)) {
            allCollaterals.forEach(collateral => {
                if (collateral.neuronId === 'unknown' || !collateral.neuronId) {
                    return;
                }
                ownerByCollateral.set(collateral.id, collateral.neuronId);
            });
        }

        dendritesByCollateral.forEach((listeners, coll) => {
            const owner = ownerByCollateral.get(coll);
            if (!owner) return;
            listeners.forEach(target => {
                if (target === owner) return;
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

        if (Array.isArray(allResponses)) {
            for (const r of allResponses) {
                if (!r) continue;
                const inColl = r?.inputCollateralId || undefined;
                const outColl = r?.outputCollateralId || undefined;
                const sourceNeuronId = outColl
                    ? ownerByCollateral.get(outColl)
                    : undefined;
                if (inColl) {
                    const listeners = dendritesByCollateral.get(inColl);
                    if (listeners && sourceNeuronId) {
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

        edgeMap.forEach(v => {
            graphConnections.push({
                from: v.from,
                to: v.to,
                weight: 0.5,
                stimulationCount: v.count,
                label: collateralName(v.label) || v.label,
            });
        });
    }

    return { neurons: graphNeurons, connections: graphConnections };
}

export function topologyView(appId: TExoBindable<string | null>): TExoSchema {
    const graphData = bindable<{
        neurons: NeuronData[];
        connections: ConnectionData[];
    }>({ neurons: [], connections: [] });
    const frontier = bindable<FrontierData>({ neurons: {}, edges: {} });
    const stimCount = bindable(0);
    const respCount = bindable(0);
    const appName = bindable('');
    const selectedNeuron = bindable<NeuronData | null>(null);

    const readSet = (
        collection: any,
        index: any,
        id: string | null
    ): any[] =>
        id ? readEntitiesByIndexKey(collection, index, id).filter(Boolean) : [];

    const recompute = (): void => {
        const id = appId.getValue();
        const allNeurons = readSet(db.neurons, db.neurons.indexes.appId, id);
        const allDendrites = readSet(db.dendrites, db.dendrites.indexes.appId, id);
        const allResponses = readSet(db.responses, db.responses.indexes.appId, id);
        const allStimulations = readSet(
            db.stimulations,
            db.stimulations.indexes.appId,
            id
        );
        const allCollaterals = readSet(
            db.collaterals,
            db.collaterals.indexes.appId,
            id
        );

        const data = buildGraphData({
            allNeurons,
            allDendrites,
            allResponses,
            allCollaterals,
        });
        graphData.setValue(data);
        frontier.setValue(
            id
                ? computeFrontier({
                      hops: allResponses,
                      stimulations: allStimulations,
                      dendrites: allDendrites,
                      collaterals: allCollaterals,
                      now: Date.now(),
                  })
                : { neurons: {}, edges: {} }
        );
        stimCount.setValue(allStimulations.length);
        respCount.setValue(allResponses.length);
        appName.setValue((id && db.apps.getOneByPk(id)?.name) || '');

        // Expose counts for E2E assertions (preserved from the React version).
        try {
            (window as any).__cnstraCounts = {
                stimulations: allStimulations.length,
                responses: allResponses.length,
            };
        } catch {}

        // NOTE: recompute() runs inside OIMDB subscription callbacks, i.e. DURING
        // a queue.flush(). OIMDB 3.9+ forbids writes during flush. So this must
        // stay read-only — do NOT upsert into OIMDB here. (The old React version
        // persisted derived graphLayouts/graphEdges in a post-render useEffect,
        // outside the flush; nothing reads those collections, so we simply drop
        // that write instead of deferring it.)
    };

    // Subscriptions: any relevant collection update, plus a selection change.
    let unsubs: Array<() => void> = [];
    const start = (): void => {
        unsubs = [
            appId.subscribe(recompute),
            db.neurons.subscribeOnAnyUpdate(recompute),
            db.dendrites.subscribeOnAnyUpdate(recompute),
            db.responses.subscribeOnAnyUpdate(recompute),
            db.stimulations.subscribeOnAnyUpdate(recompute),
            db.collaterals.subscribeOnAnyUpdate(recompute),
        ];
        recompute();
    };
    const stop = (): void => {
        for (const u of unsubs) u();
        unsubs = [];
    };

    // ── Selection callbacks (local state) ────────────────────────────────────
    const onNeuronClick = (neuron: NeuronData): void =>
        selectedNeuron.setValue(neuron);
    const onClose = (): void => selectedNeuron.setValue(null);

    // ── Stats bar (reactive row of spans; preserves data-testid for e2e) ─────
    const statsRow = combine(
        [graphData, stimCount, respCount, appId, appName, selectedNeuron],
        () => {
            const g = graphData.getValue();
            const id = appId.getValue();
            const sel = selectedNeuron.getValue();
            const rows: (TExoSchema | string)[] = [
                <span>🗺️ Network Map</span>,
                <span static={{ style: 'color:var(--infection-green)' }}>
                    🧠 {String(g.neurons.length)} neurons
                </span>,
                <span static={{ style: 'color:var(--infection-green)' }}>
                    🔗 {String(g.connections.length)} connections
                </span>,
                <span static={{ style: 'color:var(--text-secondary)' }}>
                    ⚡{' '}
                    <span
                        static={{
                            'data-testid': 'stats-stimulations',
                            class: 'stats-stimulations',
                        }}
                    >
                        {String(stimCount.getValue())}
                    </span>{' '}
                    stimulations
                </span>,
                <span static={{ style: 'color:var(--text-secondary)' }}>
                    📨{' '}
                    <span
                        static={{
                            'data-testid': 'stats-responses',
                            class: 'stats-responses',
                        }}
                    >
                        {String(respCount.getValue())}
                    </span>{' '}
                    responses
                </span>,
            ];
            if (id) rows.push(<span>📱 {appName.getValue() || 'Unknown'}</span>);
            if (sel)
                rows.push(
                    <span static={{ style: 'color:var(--infection-red)' }}>
                        🎯 {sel.name}
                    </span>
                );
            return rows;
        }
    );

    // ── CNSGraph island (stable; props emit on graph/frontier change) ────────
    const graphProps = combine([graphData, frontier], () => ({
        neurons: graphData.getValue().neurons,
        connections: graphData.getValue().connections,
        frontier: frontier.getValue(),
        onNeuronClick,
    }));
    const cnsGraphNode = cnsGraph(graphProps);

    // ── NeuronDetailsPanel island (props emit on selection/app change) ───────
    const panelProps = combine([selectedNeuron, appId], () => ({
        neuronId: selectedNeuron.getValue()?.id || '',
        onClose,
        appId: appId.getValue() || undefined,
    }));
    const neuronPanel = reactIsland(NeuronDetailsPanel, panelProps);

    // Clear-selection button, shown only while a neuron is selected.
    const clearBtn = derive(selectedNeuron, sel =>
        sel ? (
            <button
                static={{
                    class: 'clear-selection-btn',
                    title: 'Clear neuron selection',
                }}
                handlers={{ onClick: onClose }}
            >
                ✕ Clear Selection
            </button>
        ) : (
            ''
        )
    );

    // Graph region (built once, stable — so stats updates never rebuild it).
    const graphRegion: TExoSchema = (
        <>
            <div
                static={{
                    style:
                        'position:sticky;top:0;z-index:5;background:var(--bg-panel);' +
                        'border-bottom:1px solid var(--border-infected);padding:8px 12px;' +
                        'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
                }}
            >
                <div
                    static={{
                        style:
                            'display:flex;flex-wrap:wrap;gap:16px;align-items:center;' +
                            'font-size:var(--font-size-xs);color:var(--text-secondary)',
                    }}
                    bindable={{ children: statsRow }}
                />
            </div>
            <div static={{ style: 'flex:1;position:relative;overflow:hidden' }}>
                <div static={{ style: 'width:100%;height:100%', children: [cnsGraphNode] }} />
                <div bindable={{ children: clearBtn }} />
                <div static={{ children: [neuronPanel] }} />
            </div>
        </>
    );

    const placeholder = (id: string | null): TExoSchema =>
        emptyGraphPlaceholder({
            message: id ? '📊 No Network Data' : '📱 Select Application',
            submessage: id
                ? 'Network topology is empty. Make sure your application is creating neurons and stimulations.'
                : 'Choose an application from the sidebar to view its neural network topology.',
        });

    const hasNeurons = derive(graphData, g => g.neurons.length > 0);
    const mainContent = combine([hasNeurons, appId], () =>
        hasNeurons.getValue() ? graphRegion : placeholder(appId.getValue())
    );

    return (
        <div
            static={{
                style: 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden',
                onExoMount: start,
                onExoUnmount: stop,
            }}
            bindable={{ children: mainContent }}
        />
    );
}

export default topologyView;
