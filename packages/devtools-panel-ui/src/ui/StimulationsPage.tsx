import React from 'react';
import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

type Props = { appId: string };

const StimulationsPage: React.FC<Props> = ({ appId }) => {
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

    return (
        <div
            data-testid="stimulations-page"
            style={{ padding: 'var(--spacing-xl)' }}
        >
            <h3 className="decay-glow" style={{ marginTop: 0 }}>
                ⚡ Stimulations
            </h3>
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
                                    color: 'var(--text-secondary)',
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
