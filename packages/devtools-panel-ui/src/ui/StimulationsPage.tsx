import React from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

type Props = {
    appId: string;
    wsRef?: React.MutableRefObject<WebSocket | null>;
    cnsId?: string | null;
};

const StimulationsPage: React.FC<Props> = ({ appId, wsRef, cnsId }) => {
    const responses = useSelectEntitiesByIndexKey(
        db.responses,
        db.responses.indexes.appId,
        appId
    );

    const stimulations = useSelectEntitiesByIndexKey(
        db.stimulations,
        db.stimulations.indexes.appId,
        appId
    );

    // Debug logging to understand the data discrepancy
    React.useEffect(() => {
        console.log('🔍 STIMULATIONS PAGE DEBUG:', {
            appId,
            responsesCount: responses?.length || 0,
            stimulationsCount: stimulations?.length || 0,
            totalResponsesInDB: db.responses.getAll().length,
            totalStimulationsInDB: db.stimulations.getAll().length,
            responsesAppIds: responses?.slice(0, 5).map(r => r.appId),
            stimulationsAppIds: stimulations?.slice(0, 5).map(s => s.appId),
            allResponseAppIds: [
                ...new Set(db.responses.getAll().map(r => r.appId)),
            ],
            allStimulationAppIds: [
                ...new Set(db.stimulations.getAll().map(s => s.appId)),
            ],
        });
    }, [appId, responses, stimulations]);
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

    const list = hasResponses
        ? (responses || []).slice().sort((a, b) => b.timestamp - a.timestamp)
        : hasStimulations
        ? (stimulations || []).slice().sort((a, b) => b.timestamp - a.timestamp)
        : [];

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

    // Simple collapsible JSON viewer
    const JsonView: React.FC<{ data: unknown; level?: number }> = ({
        data,
        level = 0,
    }) => {
        const [open, setOpen] = React.useState(level < 1);
        if (data === null || typeof data !== 'object') {
            return (
                <span style={{ color: 'var(--text-secondary)' }}>
                    {JSON.stringify(data)}
                </span>
            );
        }
        const isArray = Array.isArray(data);
        const keys = isArray
            ? (data as unknown[]).map((_, i) => i)
            : Object.keys(data as Record<string, unknown>);
        return (
            <div style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                <span
                    onClick={() => setOpen(!open)}
                    style={{
                        cursor: 'pointer',
                        color: 'var(--infection-blue)',
                    }}
                >
                    {open ? '▼' : '▶'} {isArray ? 'Array' : 'Object'} (
                    {keys.length})
                </span>
                {open && (
                    <div style={{ paddingLeft: 12 }}>
                        {keys.map((k: any) => (
                            <div key={String(k)}>
                                {!isArray && (
                                    <span
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        {String(k)}:{' '}
                                    </span>
                                )}
                                <JsonView
                                    data={
                                        isArray
                                            ? (data as unknown[])[k as number]
                                            : (data as Record<string, unknown>)[
                                                  k as string
                                              ]
                                    }
                                    level={level + 1}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Replay UI state
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
            style={{ padding: 'var(--spacing-xl)' }}
        >
            <h3 className="decay-glow" style={{ marginTop: 0 }}>
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
            {/* Replay options controls */}
            {wsRef?.current && (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: 8,
                        alignItems: 'center',
                        marginBottom: 12,
                    }}
                >
                    <input
                        placeholder="delay ms"
                        value={replayDelay}
                        onChange={e => setReplayDelay(e.target.value)}
                        style={{ fontSize: '10px', padding: 4 }}
                    />
                    <input
                        placeholder="timeout ms"
                        value={replayTimeout}
                        onChange={e => setReplayTimeout(e.target.value)}
                        style={{ fontSize: '10px', padding: 4 }}
                    />
                    <input
                        placeholder="max hops"
                        value={replayHops}
                        onChange={e => setReplayHops(e.target.value)}
                        style={{ fontSize: '10px', padding: 4 }}
                    />
                    <input
                        placeholder="concurrency"
                        value={replayConcurrency}
                        onChange={e => setReplayConcurrency(e.target.value)}
                        style={{ fontSize: '10px', padding: 4 }}
                    />
                    <input
                        placeholder="allowedNames (comma)"
                        value={replayAllowed}
                        onChange={e => setReplayAllowed(e.target.value)}
                        style={{ fontSize: '10px', padding: 4 }}
                    />
                </div>
            )}
            {lastReplayResult && (
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        marginBottom: 12,
                        color: lastReplayResult.ok
                            ? 'var(--text-success)'
                            : 'var(--text-error)',
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
                    display: 'grid',
                    gap: 'var(--spacing-sm)',
                    maxHeight: '70vh',
                    overflowY: 'auto',
                    paddingRight: '8px',
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
                {list.map(item => {
                    const isResponse = hasResponses && 'responseId' in item;
                    const isStimulation =
                        !isResponse && 'stimulationId' in item;
                    const itemId = isResponse
                        ? item.responseId
                        : item.stimulationId;

                    return (
                        <div
                            key={itemId}
                            style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-accent)',
                                borderRadius: 'var(--radius-sm)',
                                padding: 'var(--spacing-sm)',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 'var(--font-size-xs)',
                                }}
                            >
                                <span>id: {itemId}</span>
                                <span>
                                    {new Date(
                                        item.timestamp
                                    ).toLocaleTimeString()}
                                </span>
                            </div>
                            <div
                                style={{
                                    fontSize: 'var(--font-size-xs)',
                                    color: (item as any).error
                                        ? 'var(--text-error)'
                                        : 'var(--text-secondary)',
                                }}
                            >
                                {isResponse
                                    ? (() => {
                                          const stimulation =
                                              stimulationMap.get(
                                                  item.stimulationId
                                              );
                                          const trace =
                                              traceByStimulation.get(
                                                  item.stimulationId as any
                                              ) || [];
                                          return (
                                              <>
                                                  {stimulation && (
                                                      <div
                                                          style={{
                                                              marginBottom:
                                                                  '4px',
                                                          }}
                                                      >
                                                          <strong>Flow:</strong>{' '}
                                                          {stimulation.neuronId}{' '}
                                                          → [
                                                          {item.inputCollateralName ||
                                                              stimulation.collateralName}
                                                          ] → {item.neuronId}
                                                      </div>
                                                  )}
                                                  <div>
                                                      duration:{' '}
                                                      {item.duration || '-'}ms |
                                                      error:{' '}
                                                      {item.error || 'none'}
                                                  </div>
                                                  {stimulation &&
                                                      wsRef?.current && (
                                                          <div
                                                              style={{
                                                                  marginTop: 6,
                                                              }}
                                                          >
                                                              <button
                                                                  className="btn-infected"
                                                                  onClick={() =>
                                                                      handleReplay(
                                                                          item.stimulationId as any
                                                                      )
                                                                  }
                                                                  style={{
                                                                      fontSize:
                                                                          '10px',
                                                                      padding:
                                                                          '4px 6px',
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
                                                              marginTop: 6,
                                                          }}
                                                      >
                                                          <strong>
                                                              Trace:
                                                          </strong>
                                                          <ol
                                                              style={{
                                                                  paddingLeft: 16,
                                                              }}
                                                          >
                                                              {trace.map(
                                                                  (
                                                                      hop,
                                                                      idx
                                                                  ) => (
                                                                      <li
                                                                          key={
                                                                              (hop.responseId as string) ||
                                                                              idx
                                                                          }
                                                                      >
                                                                          <span>
                                                                              {hop.hopIndex ??
                                                                                  idx}
                                                                              .{' '}
                                                                              {
                                                                                  hop.neuronId
                                                                              }
                                                                              {hop.outputCollateralName && (
                                                                                  <>
                                                                                      {' '}
                                                                                      →
                                                                                      [
                                                                                      {
                                                                                          hop.outputCollateralName
                                                                                      }

                                                                                      ]
                                                                                  </>
                                                                              )}
                                                                          </span>
                                                                          {typeof hop.duration ===
                                                                              'number' && (
                                                                              <span
                                                                                  style={{
                                                                                      color: 'var(--text-muted)',
                                                                                  }}
                                                                              >
                                                                                  {' '}
                                                                                  (
                                                                                  {
                                                                                      hop.duration
                                                                                  }
                                                                                  ms)
                                                                              </span>
                                                                          )}
                                                                      </li>
                                                                  )
                                                              )}
                                                          </ol>
                                                      </div>
                                                  )}
                                                  {(item.responsePayload ||
                                                      item.inputPayload ||
                                                      item.outputPayload ||
                                                      item.contexts) && (
                                                      <div
                                                          style={{
                                                              marginTop: 6,
                                                          }}
                                                      >
                                                          <div
                                                              style={{
                                                                  display:
                                                                      'flex',
                                                                  gap: 8,
                                                                  flexWrap:
                                                                      'wrap',
                                                              }}
                                                          >
                                                              {Boolean(
                                                                  item.inputPayload
                                                              ) && (
                                                                  <div
                                                                      style={{
                                                                          background:
                                                                              'var(--bg-panel)',
                                                                          border: '1px solid var(--border-primary)',
                                                                          borderRadius: 4,
                                                                          padding: 6,
                                                                          minWidth: 200,
                                                                      }}
                                                                  >
                                                                      <strong
                                                                          style={{
                                                                              color: 'var(--text-primary)',
                                                                          }}
                                                                      >
                                                                          Input
                                                                          Payload
                                                                      </strong>
                                                                      <JsonView
                                                                          data={
                                                                              item.inputPayload as any
                                                                          }
                                                                      />
                                                                  </div>
                                                              )}
                                                              {Boolean(
                                                                  item.outputPayload ||
                                                                      item.responsePayload
                                                              ) && (
                                                                  <div
                                                                      style={{
                                                                          background:
                                                                              'var(--bg-panel)',
                                                                          border: '1px solid var(--border-primary)',
                                                                          borderRadius: 4,
                                                                          padding: 6,
                                                                          minWidth: 200,
                                                                      }}
                                                                  >
                                                                      <strong
                                                                          style={{
                                                                              color: 'var(--text-primary)',
                                                                          }}
                                                                      >
                                                                          Output
                                                                          Payload
                                                                      </strong>
                                                                      <JsonView
                                                                          data={
                                                                              (item.outputPayload as any) ??
                                                                              (item.responsePayload as any)
                                                                          }
                                                                      />
                                                                  </div>
                                                              )}
                                                              {Boolean(
                                                                  item.contexts
                                                              ) && (
                                                                  <div
                                                                      style={{
                                                                          background:
                                                                              'var(--bg-panel)',
                                                                          border: '1px solid var(--border-primary)',
                                                                          borderRadius: 4,
                                                                          padding: 6,
                                                                          minWidth: 200,
                                                                      }}
                                                                  >
                                                                      <strong
                                                                          style={{
                                                                              color: 'var(--text-primary)',
                                                                          }}
                                                                      >
                                                                          Contexts
                                                                          Snapshot
                                                                      </strong>
                                                                      <JsonView
                                                                          data={
                                                                              item.contexts
                                                                          }
                                                                      />
                                                                  </div>
                                                              )}
                                                          </div>
                                                      </div>
                                                  )}
                                              </>
                                          );
                                      })()
                                    : isStimulation
                                    ? // Render stimulation details
                                      (() => {
                                          const stim = item as any; // Type assertion for stimulation
                                          return (
                                              <>
                                                  <div
                                                      style={{
                                                          marginBottom: '4px',
                                                      }}
                                                  >
                                                      <strong>Signal:</strong>{' '}
                                                      {stim.neuronId} → [
                                                      {stim.collateralName}]
                                                  </div>
                                                  <div>
                                                      payload:{' '}
                                                      {stim.payload
                                                          ? JSON.stringify(
                                                                stim.payload
                                                            ).substring(0, 50) +
                                                            '...'
                                                          : 'none'}
                                                  </div>
                                                  {wsRef?.current && (
                                                      <div
                                                          style={{
                                                              marginTop: 6,
                                                          }}
                                                      >
                                                          <button
                                                              className="btn-infected"
                                                              onClick={() =>
                                                                  handleReplay(
                                                                      stim.stimulationId
                                                                  )
                                                              }
                                                              style={{
                                                                  fontSize:
                                                                      '10px',
                                                                  padding:
                                                                      '4px 6px',
                                                                  border: '1px solid var(--border-primary)',
                                                              }}
                                                          >
                                                              ▶️ Replay
                                                          </button>
                                                      </div>
                                                  )}
                                              </>
                                          );
                                      })()
                                    : 'Unknown item type'}
                            </div>
                        </div>
                    );
                })}
                {list.length === 0 && (
                    <div
                        style={{
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                        }}
                    >
                        No stimulations yet. Interact with your app to generate
                        activity.
                    </div>
                )}
            </div>
        </div>
    );
};

export default StimulationsPage;
