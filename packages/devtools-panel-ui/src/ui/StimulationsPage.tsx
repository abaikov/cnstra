import React, { useMemo, useRef, useCallback } from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';
import { JsonViewer } from './JsonViewer';
import { ResponseDataViewer } from './ResponseDataViewer';

type Props = {
    appId: string;
    wsRef?: React.MutableRefObject<WebSocket | null>;
    cnsId?: string | null;
};

// Component for virtual list item
interface ResponseListItemProps {
    index: number;
    style: React.CSSProperties;
    data: {
        list: any[];
        hasResponses: boolean;
        stimulationMap: Map<string, any>;
        traceByStimulation: Map<string, any[]>;
        wsRef?: React.MutableRefObject<WebSocket | null>;
        handleReplay: (
            stimulationId: string,
            payload?: unknown,
            contexts?: any
        ) => Promise<void>;
    };
}

const ResponseListItem: React.FC<ResponseListItemProps> = ({
    index,
    style,
    data,
}) => {
    const {
        list,
        hasResponses,
        stimulationMap,
        traceByStimulation,
        wsRef,
        handleReplay,
    } = data;
    const item = list[index];
    const isResponse = hasResponses && 'responseId' in item;
    const isStimulation = !isResponse && 'stimulationId' in item;
    const itemId = isResponse ? item.responseId : item.stimulationId;

    return (
        <div
            style={{
                paddingRight: '8px',
                paddingBottom: 'var(--spacing-sm)',
            }}
        >
            <div
                style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-accent)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--spacing-md)',
                    position: 'relative',
                    transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.borderColor =
                        'var(--border-infected)';
                    e.currentTarget.style.boxShadow =
                        '0 2px 8px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-accent)';
                    e.currentTarget.style.boxShadow = 'none';
                }}
            >
                {/* Header with type indicator and timestamp */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 'var(--spacing-sm)',
                        paddingBottom: 'var(--spacing-xs)',
                        borderBottom: '1px solid var(--border-subtle)',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-xs)',
                        }}
                    >
                        <span
                            style={{
                                background: isResponse
                                    ? 'var(--decay-orange)'
                                    : 'var(--decay-blue)',
                                color: 'white',
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: 'var(--font-size-2xs)',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                            }}
                        >
                            {isResponse ? 'Response' : 'Stimulation'}
                        </span>
                        <span
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)',
                            }}
                        >
                            #{itemId}
                        </span>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-xs)',
                        }}
                    >
                        <span
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                        {(item as any).error && (
                            <span
                                style={{
                                    color: 'var(--text-error)',
                                    fontSize: 'var(--font-size-xs)',
                                }}
                            >
                                ⚠️ Error
                            </span>
                        )}
                        {/* Show replay indicator if stimulationId contains "-replay-" */}
                        {typeof item.stimulationId === 'string' &&
                            item.stimulationId.includes('-replay-') && (
                                <span
                                    style={{
                                        color: 'var(--text-muted)',
                                        fontSize: 'var(--font-size-xs)',
                                        fontStyle: 'italic',
                                    }}
                                    title="This response was generated from a replay"
                                >
                                    🔁 Replay
                                </span>
                            )}
                    </div>
                </div>

                {/* Content - same as before */}
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color: (item as any).error
                            ? 'var(--text-error)'
                            : 'var(--text-primary)',
                    }}
                >
                    {isResponse
                        ? renderResponse(
                              item,
                              stimulationMap,
                              traceByStimulation,
                              wsRef,
                              handleReplay
                          )
                        : isStimulation
                        ? renderStimulation(item, wsRef, handleReplay)
                        : 'Unknown item type'}
                </div>
            </div>
        </div>
    );
};

// Helper functions to render response and stimulation content
const renderResponse = (
    item: any,
    stimulationMap: Map<string, any>,
    traceByStimulation: Map<string, any[]>,
    wsRef?: React.MutableRefObject<WebSocket | null>,
    handleReplay?: (
        stimulationId: string,
        payload?: unknown,
        contexts?: any
    ) => Promise<void>
) => {
    const stimulation = stimulationMap.get(item.stimulationId);
    const trace = traceByStimulation.get(item.stimulationId as any) || [];

    return (
        <>
            {/* Flow information */}
            {stimulation && (
                <div
                    style={{
                        marginBottom: 'var(--spacing-sm)',
                        padding: 'var(--spacing-xs)',
                        background: 'var(--bg-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            marginBottom: '2px',
                        }}
                    >
                        🔄 Signal Flow
                    </div>
                    <div
                        style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        {stimulation.neuronId} → [
                        {item.inputCollateralName || stimulation.collateralName}
                        ]
                    </div>
                </div>
            )}

            {/* Replay indicator badge */}
            {typeof item.stimulationId === 'string' &&
                item.stimulationId.includes('-replay-') && (
                    <div
                        style={{
                            marginBottom: 'var(--spacing-xs)',
                            padding: '4px 8px',
                            background: 'var(--bg-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px dashed var(--border-primary)',
                            display: 'inline-block',
                        }}
                    >
                        <span
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                                fontStyle: 'italic',
                            }}
                        >
                            🔁 Replay response
                        </span>
                    </div>
                )}

            {/* Metrics */}
            <div
                style={{
                    display: 'flex',
                    gap: 'var(--spacing-md)',
                    marginBottom: 'var(--spacing-sm)',
                    flexWrap: 'wrap',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}
                >
                    <span style={{ color: 'var(--text-muted)' }}>⏱️</span>
                    <span style={{ fontSize: 'var(--font-size-xs)' }}>
                        {item.duration || '-'} ms
                    </span>
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}
                >
                    <span style={{ color: 'var(--text-muted)' }}>🔗</span>
                    <span style={{ fontSize: 'var(--font-size-xs)' }}>
                        {item.inputCollateralName || 'N/A'} →{' '}
                        {item.outputCollateralName || 'N/A'}
                    </span>
                </div>
                {item.error && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--text-error)',
                        }}
                    >
                        <span>⚠️</span>
                        <span style={{ fontSize: 'var(--font-size-xs)' }}>
                            {item.error}
                        </span>
                    </div>
                )}
            </div>
            {stimulation && wsRef?.current && handleReplay && (
                <div style={{ marginTop: 6 }}>
                    <button
                        className="btn-infected"
                        onClick={() => handleReplay(item.stimulationId as any)}
                        style={{
                            fontSize: '10px',
                            padding: '4px 6px',
                            border: '1px solid var(--border-primary)',
                        }}
                    >
                        ▶️ Replay
                    </button>
                </div>
            )}
            {trace.length > 0 && (
                <div
                    style={{
                        marginTop: 'var(--spacing-sm)',
                        padding: 'var(--spacing-xs)',
                        background: 'var(--bg-panel)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            marginBottom: 'var(--spacing-xs)',
                            fontWeight: 'bold',
                        }}
                    >
                        🔍 Execution Trace ({trace.length} hops)
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                        }}
                    >
                        {trace.map((hop, idx) => (
                            <div
                                key={(hop.responseId as string) || idx}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-xs)',
                                    padding: '2px 4px',
                                    borderRadius: 'var(--radius-xs)',
                                    background:
                                        idx % 2 === 0
                                            ? 'var(--bg-subtle)'
                                            : 'transparent',
                                    fontSize: 'var(--font-size-xs)',
                                }}
                            >
                                <span
                                    style={{
                                        color: 'var(--text-muted)',
                                        fontFamily: 'var(--font-mono)',
                                        minWidth: '20px',
                                    }}
                                >
                                    {hop.hopIndex ?? idx + 1}.
                                </span>
                                <span
                                    style={{
                                        color: 'var(--text-accent)',
                                        fontFamily: 'var(--font-mono)',
                                    }}
                                >
                                    {hop.neuronId}
                                </span>
                                {hop.outputCollateralName && (
                                    <>
                                        <span
                                            style={{
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            →
                                        </span>
                                        <span
                                            style={{
                                                color: 'var(--decay-orange)',
                                                fontFamily: 'var(--font-mono)',
                                            }}
                                        >
                                            [{hop.outputCollateralName}]
                                        </span>
                                    </>
                                )}
                                {typeof hop.duration === 'number' && (
                                    <span
                                        style={{
                                            color: 'var(--text-muted)',
                                            fontSize: 'var(--font-size-2xs)',
                                            marginLeft: 'auto',
                                        }}
                                    >
                                        {hop.duration} ms
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {(item.responsePayload ||
                item.inputPayload ||
                item.outputPayload ||
                item.contexts) && (
                <div
                    style={{
                        marginTop: 'var(--spacing-sm)',
                        padding: 'var(--spacing-xs)',
                        background: 'var(--bg-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                    }}
                >
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            marginBottom: 'var(--spacing-xs)',
                            fontWeight: 'bold',
                        }}
                    >
                        📦 Data Payloads
                    </div>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'repeat(auto-fit, minmax(250px, 1fr))',
                            gap: 'var(--spacing-sm)',
                        }}
                    >
                        <ResponseDataViewer
                            data={{
                                inputPayload: item.inputPayload,
                                outputPayload: item.outputPayload,
                                responsePayload: item.responsePayload,
                                contexts: item.contexts,
                                snapshot: (item as any).snapshot,
                            }}
                            title="Response Data"
                            defaultExpanded={false}
                            responseId={item.responseId}
                        />
                    </div>
                </div>
            )}
        </>
    );
};

const renderStimulation = (
    item: any,
    wsRef?: React.MutableRefObject<WebSocket | null>,
    handleReplay?: (
        stimulationId: string,
        payload?: unknown,
        contexts?: any
    ) => Promise<void>
) => {
    const stim = item;
    return (
        <>
            <div
                style={{
                    marginBottom: 'var(--spacing-sm)',
                    padding: 'var(--spacing-xs)',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                }}
            >
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        marginBottom: '2px',
                    }}
                >
                    🚀 Signal Trigger
                </div>
                <div
                    style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-primary)',
                    }}
                >
                    {stim.neuronId} → [{stim.collateralName}]
                </div>
            </div>
            <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        marginBottom: 'var(--spacing-xs)',
                        fontWeight: 'bold',
                    }}
                >
                    📦 Signal Payload
                </div>
                <JsonViewer
                    data={stim.payload || 'none'}
                    title=""
                    defaultExpanded={false}
                />
            </div>
            {wsRef?.current && handleReplay && (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        marginTop: 'var(--spacing-sm)',
                    }}
                >
                    <button
                        className="btn-infected"
                        onClick={() => handleReplay(stim.stimulationId)}
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            padding: 'var(--spacing-xs) var(--spacing-sm)',
                            border: '1px solid var(--border-primary)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--decay-blue)',
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background =
                                'var(--decay-orange)';
                            e.currentTarget.style.transform = 'scale(1.05)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background =
                                'var(--decay-blue)';
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        ▶️ Replay Signal
                    </button>
                </div>
            )}
        </>
    );
};

const StimulationsPage: React.FC<Props> = ({ appId, wsRef, cnsId }) => {
    const listContainerRef = useRef<HTMLDivElement>(null);

    const responsesRaw = useSelectEntitiesByIndexKey(
        db.responses,
        db.responses.indexes.appId,
        appId
    );

    const stimulationsRaw = useSelectEntitiesByIndexKey(
        db.stimulations,
        db.stimulations.indexes.appId,
        appId
    );

    // Filter out undefined elements
    const responses = responsesRaw
        ? responsesRaw.filter((r): r is NonNullable<typeof r> => r != null)
        : null;

    const stimulations = stimulationsRaw
        ? stimulationsRaw.filter((s): s is NonNullable<typeof s> => s != null)
        : null;

    // Removed verbose debug logging
    // Create a map of stimulations for quick lookup
    const stimulationMap = React.useMemo(() => {
        const map = new Map();
        (stimulations || []).forEach(stim => {
            map.set(stim.stimulationId, stim);
        });
        return map;
    }, [stimulations]);

    // If we have no responses but we have stimulations, show stimulations instead
    const hasResponses = responses && responses.length > 0;
    const hasStimulations = stimulations && stimulations.length > 0;

    // Filter by input collateral name
    const [collateralNameFilter, setCollateralNameFilter] =
        React.useState<string>('');

    // Filter and sort: newest first (last responses at top), oldest at bottom
    const filteredList = React.useMemo(() => {
        const rawList = hasResponses
            ? (responses || []).slice()
            : hasStimulations
            ? (stimulations || []).slice()
            : [];

        // Filter by input collateral name (partial match)
        if (collateralNameFilter.trim()) {
            const filterLower = collateralNameFilter.toLowerCase().trim();
            return rawList.filter((item: any) => {
                const inputCollateral =
                    item.inputCollateralName || item.collateralName || '';
                return inputCollateral.toLowerCase().includes(filterLower);
            });
        }

        return rawList;
    }, [
        hasResponses,
        hasStimulations,
        responses,
        stimulations,
        collateralNameFilter,
    ]);

    const list = filteredList.sort((a, b) => b.timestamp - a.timestamp);

    const displayType = hasResponses
        ? 'responses'
        : hasStimulations
        ? 'stimulations'
        : 'responses';

    // Fetch replay history for this app when ws is ready
    React.useEffect(() => {
        if (!wsRef?.current || wsRef.current.readyState !== WebSocket.OPEN)
            return;
        try {
            wsRef.current.send(
                JSON.stringify({ type: 'apps:get-replays', appId })
            );
        } catch {}
    }, [wsRef?.current, appId]);

    // Listen for apps:replays locally and store in component state
    const [replays, setReplays] = React.useState<any[]>([]);
    React.useEffect(() => {
        if (!wsRef?.current) return;
        const handler = (ev: MessageEvent) => {
            try {
                const msg =
                    typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
                if (msg && msg.type === 'apps:replays' && msg.appId === appId) {
                    setReplays(Array.isArray(msg.replays) ? msg.replays : []);
                }
            } catch {}
        };
        wsRef.current.addEventListener('message', handler as any);
        return () => {
            wsRef.current?.removeEventListener('message', handler as any);
        };
    }, [wsRef?.current, appId]);

    // Build trace map per stimulationId
    const traceByStimulation = React.useMemo(() => {
        const map = new Map<string, Array<any>>();
        for (const r of responses || []) {
            const stimId = r.stimulationId as string;
            const arr = map.get(stimId) || [];
            arr.push(r);
            map.set(stimId, arr);
        }
        for (const [k, arr] of map.entries()) {
            const hasHop = arr.some(x => typeof x.hopIndex === 'number');
            arr.sort((a, b) => {
                if (hasHop) {
                    const ah =
                        typeof a.hopIndex === 'number'
                            ? a.hopIndex
                            : Number.MAX_SAFE_INTEGER;
                    const bh =
                        typeof b.hopIndex === 'number'
                            ? b.hopIndex
                            : Number.MAX_SAFE_INTEGER;
                    if (ah !== bh) return ah - bh;
                }
                return a.timestamp - b.timestamp;
            });
        }
        return map;
    }, [responses]);

    // Replay UI state (hidden by default, can be set via defaults)
    const [replayDelay, setReplayDelay] = React.useState<string>('');
    const [replayTimeout, setReplayTimeout] = React.useState<string>('');
    const [replayHops, setReplayHops] = React.useState<string>('');
    const [replayConcurrency, setReplayConcurrency] =
        React.useState<string>('');
    const [replayAllowed, setReplayAllowed] = React.useState<string>('');
    const [lastReplayResult, setLastReplayResult] = React.useState<
        { ok: true; detail: any } | { ok: false; detail: any } | null
    >(null);

    // Replay handler
    const handleReplay = React.useCallback(
        async (stimulationId: string, payload?: unknown, contexts?: any) => {
            if (!wsRef?.current || wsRef.current.readyState !== WebSocket.OPEN)
                return;
            const stim = stimulationMap.get(stimulationId);
            if (!stim) return;
            const cmd = {
                type: 'stimulate',
                stimulationCommandId: `${stimulationId}-replay-${Date.now()}`,
                appId: appId,
                cnsId: cnsId || undefined,
                collateralName: stim.collateralName,
                payload: payload ?? stim.payload,
                contexts: contexts ?? undefined,
                options: {
                    maxNeuronHops: replayHops ? Number(replayHops) : 128,
                    concurrency: replayConcurrency
                        ? Number(replayConcurrency)
                        : undefined,
                    timeoutMs: replayTimeout
                        ? Number(replayTimeout)
                        : undefined,
                    allowedNames: replayAllowed
                        ? replayAllowed
                              .split(',')
                              .map(s => s.trim())
                              .filter(Boolean)
                        : undefined,
                },
            } as any;
            // Wait for ack/nack once
            const waitForAck = new Promise(resolve => {
                const handler = (ev: MessageEvent) => {
                    try {
                        const msg =
                            typeof ev.data === 'string'
                                ? JSON.parse(ev.data)
                                : null;
                        if (!msg) return;
                        if (
                            msg.type === 'stimulate-accepted' ||
                            msg.type === 'stimulate-rejected'
                        ) {
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
            const delayMs = replayDelay ? Number(replayDelay) : 0;
            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
            wsRef.current.send(JSON.stringify(cmd));
            const ack = (await waitForAck) as any;
            setLastReplayResult(
                ack?.type === 'stimulate-accepted'
                    ? { ok: true, detail: ack }
                    : { ok: false, detail: ack }
            );
        },
        [
            wsRef,
            appId,
            cnsId,
            stimulationMap,
            replayDelay,
            replayTimeout,
            replayHops,
            replayConcurrency,
            replayAllowed,
        ]
    );

    // Live Replay Log (correlate by stimulationId on accept)
    const [replayLog, setReplayLog] = React.useState<
        Array<{
            time: number;
            stimulationId: string;
            message: string;
            level: 'info' | 'error';
        }>
    >([]);
    React.useEffect(() => {
        if (!wsRef?.current) return;
        const handler = (ev: MessageEvent) => {
            try {
                const msg =
                    typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
                if (!msg) return;
                if (msg.type === 'stimulate-accepted') {
                    setReplayLog(prev =>
                        prev.concat([
                            {
                                time: Date.now(),
                                stimulationId: msg.stimulationCommandId,
                                message: 'Accepted',
                                level: 'info',
                            },
                        ])
                    );
                }
                if (msg.type === 'stimulate-rejected') {
                    setReplayLog(prev =>
                        prev.concat([
                            {
                                time: Date.now(),
                                stimulationId: msg.stimulationCommandId,
                                message: String(msg.error || 'Rejected'),
                                level: 'error',
                            },
                        ])
                    );
                }
                if (msg.type === 'stimulation-batch') {
                    const arr = Array.isArray(msg.stimulations)
                        ? msg.stimulations
                        : [];
                    const lines = arr.map((s: any) => ({
                        time: s.timestamp,
                        stimulationId: s.stimulationId,
                        message: `Hop @ ${s.neuronId} via [${s.collateralName}]`,
                        level: s.error ? ('error' as const) : ('info' as const),
                    }));
                    if (lines.length > 0)
                        setReplayLog(prev => prev.concat(lines));
                }
            } catch {}
        };
        wsRef.current.addEventListener('message', handler as any);
        return () =>
            wsRef.current?.removeEventListener('message', handler as any);
    }, [wsRef?.current]);

    return (
        <div
            data-testid="stimulations-page"
            style={{
                padding: 'var(--spacing-xl)',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
            }}
        >
            <h3 className="decay-glow" style={{ marginTop: 0, flexShrink: 0 }}>
                ⚡ Stimulations
                <span
                    style={{
                        marginLeft: 8,
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-error)',
                    }}
                >
                    {Array.isArray(stimulations)
                        ? stimulations.filter((s: any) => s?.error).length
                        : 0}{' '}
                    errors
                </span>
            </h3>
            {/* Search filter for input collateral name */}
            <div
                style={{
                    marginBottom: 12,
                    flexShrink: 0,
                }}
            >
                <input
                    placeholder="🔍 Search by input collateral name..."
                    value={collateralNameFilter}
                    onChange={e => setCollateralNameFilter(e.target.value)}
                    style={{
                        width: '100%',
                        fontSize: 'var(--font-size-sm)',
                        padding: '8px 12px',
                        border: '1px solid var(--border-primary)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)',
                        color: 'var(--text-primary)',
                    }}
                />
            </div>
            {lastReplayResult && (
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        marginBottom: 12,
                        color: lastReplayResult.ok
                            ? 'var(--text-success)'
                            : 'var(--text-error)',
                        flexShrink: 0,
                    }}
                >
                    {lastReplayResult.ok ? '✅' : '❌'} Replay{' '}
                    {lastReplayResult.ok ? 'accepted' : 'rejected'}
                </div>
            )}
            {/* Replay Log panel */}
            {replayLog.length > 0 && (
                <div
                    style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 8,
                        marginBottom: 12,
                        maxHeight: 160,
                        overflowY: 'auto',
                        flexShrink: 0,
                    }}
                >
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            marginBottom: 6,
                        }}
                    >
                        Replay Log
                    </div>
                    {replayLog.slice(-100).map((r, i) => (
                        <div
                            key={i}
                            style={{
                                fontSize: '10px',
                                color:
                                    r.level === 'error'
                                        ? 'var(--text-error)'
                                        : 'var(--text-secondary)',
                            }}
                        >
                            {new Date(r.time).toLocaleTimeString()} •{' '}
                            {r.stimulationId}: {r.message}
                        </div>
                    ))}
                </div>
            )}

            <div
                style={{
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--spacing-md)',
                    flexShrink: 0,
                }}
            >
                Total {displayType}: {list.length}
                {hasStimulations && !hasResponses && (
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                        }}
                    >
                        Showing stimulations (no responses received yet)
                    </div>
                )}
                {/* Replay history summary */}
                {replays && replays.length > 0 && (
                    <div
                        style={{
                            marginTop: 8,
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-secondary)',
                        }}
                    >
                        Replay history: {replays.length}{' '}
                        <button
                            className="btn-infected"
                            onClick={() => {
                                try {
                                    wsRef?.current?.send(
                                        JSON.stringify({
                                            type: 'apps:get-replays',
                                            appId,
                                        })
                                    );
                                } catch {}
                            }}
                            style={{
                                marginLeft: 8,
                                fontSize: '10px',
                                padding: '2px 6px',
                                border: '1px solid var(--border-primary)',
                            }}
                        >
                            Refresh
                        </button>
                    </div>
                )}
            </div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    overflow: 'hidden',
                }}
            >
                {/* Minimal replay list */}
                {replays && replays.length > 0 && (
                    <div
                        style={{
                            background: 'var(--bg-card)',
                            border: '1px dashed var(--border-primary)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '8px',
                            marginBottom: 'var(--spacing-sm)',
                            flexShrink: 0,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                                marginBottom: 6,
                            }}
                        >
                            Recent Replays
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                            {replays.slice(-10).map((r: any, idx: number) => (
                                <div
                                    key={
                                        (r.stimulationCommandId as string) ||
                                        idx
                                    }
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        fontSize: 'var(--font-size-xs)',
                                    }}
                                >
                                    <span>
                                        {new Date(
                                            r.timestamp
                                        ).toLocaleTimeString()}{' '}
                                        • {r.collateralName || '-'}
                                    </span>
                                    <span
                                        style={{
                                            color:
                                                r.result === 'accepted'
                                                    ? 'var(--text-success)'
                                                    : r.result === 'rejected'
                                                    ? 'var(--text-error)'
                                                    : 'var(--text-secondary)',
                                        }}
                                    >
                                        {r.result || 'pending'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {/* List with pagination for performance */}
                {list.length > 0 ? (
                    <div
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            minHeight: 0,
                        }}
                        ref={listContainerRef}
                    >
                        {list.map((item, index) => {
                            const isResponse =
                                !!hasResponses && 'responseId' in item;
                            const isStimulation =
                                !isResponse && 'stimulationId' in item;
                            const itemId = isResponse
                                ? item.responseId
                                : item.stimulationId;

                            return (
                                <ResponseListItem
                                    key={itemId}
                                    index={index}
                                    style={{}}
                                    data={{
                                        list,
                                        hasResponses: !!hasResponses,
                                        stimulationMap,
                                        traceByStimulation,
                                        wsRef,
                                        handleReplay,
                                    }}
                                />
                            );
                        })}
                    </div>
                ) : (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 'var(--spacing-xl)',
                            textAlign: 'center',
                            background: 'var(--bg-subtle)',
                            borderRadius: 'var(--radius-md)',
                            border: '2px dashed var(--border-accent)',
                            margin: 'var(--spacing-md) 0',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '48px',
                                marginBottom: 'var(--spacing-sm)',
                            }}
                        >
                            🔌
                        </div>
                        <div
                            style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--text-muted)',
                                marginBottom: 'var(--spacing-xs)',
                                fontWeight: 'bold',
                            }}
                        >
                            No Activity Detected
                        </div>
                        <div
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                                maxWidth: '300px',
                                lineHeight: '1.4',
                            }}
                        >
                            Interact with your application to generate neural
                            network activity. Stimulations and responses will
                            appear here in real-time.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StimulationsPage;
