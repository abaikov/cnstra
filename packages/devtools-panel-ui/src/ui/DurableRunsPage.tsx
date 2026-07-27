import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import type { ICNSDurableRunsClient } from '../durable/ICNSDurableRunsClient';
import type { TCNSDurableRunView } from '../durable/TCNSDurableRunView';

// Native Exodra "Durable Runs" admin page — the retry-admin folded into the panel.
// It POLLS the durable-runs service (ICNSDurableRunsClient) every 2s while mounted
// (polling, not socket push: runs change on a button press, not in a stream) and
// renders roster → attempt timeline → task waterfall with Launch / Retry / Clone.
// Styled with the panel's own "Rotting Flesh" theme vars.

const POLL_MS = 2000;

const pp = (v: unknown): string => {
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
};

const badge = (status: string): TExoSchema => {
    const color =
        status === 'completed'
            ? 'var(--text-success)'
            : status === 'failed'
              ? 'var(--text-error)'
              : 'var(--text-warning)';
    return (
        <span
            static={{
                style:
                    `font-size:10px;padding:2px 7px;letter-spacing:1px;text-transform:uppercase;` +
                    `border:1px solid ${color};color:${color};white-space:nowrap`,
            }}
        >
            {status}
        </span>
    );
};

export type DurableRunsPageOptions = {
    /** Show the Launch (fails)/(ok) toolbar. Off for pure observability. Default on. */
    canLaunch?: boolean;
    /** Header title. Default "Durable Runs". */
    title?: string;
    /** Header icon. Default "💀". */
    icon?: string;
};

export function durableRunsPage(
    client: ICNSDurableRunsClient,
    opts: DurableRunsPageOptions = {}
): TExoSchema {
    const canLaunch = opts.canLaunch ?? true;
    const title = opts.title ?? 'Durable Runs';
    const icon = opts.icon ?? '💀';
    const runsB = bindable<TCNSDurableRunView[]>([]);
    const selectedB = bindable<string | null>(null);
    const backendB = bindable<string>('…');
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = (): void => {
        client
            .listRuns()
            .then(rs => {
                runsB.setValue(rs);
                const sel = selectedB.getValue();
                if (rs.length && (sel == null || !rs.some(r => r.runId === sel)))
                    selectedB.setValue(rs[rs.length - 1].runId);
            })
            .catch(() => {});
    };

    const doLaunch = (fail: boolean): void => {
        void client.launch({ fail }).then(refresh).catch(() => {});
    };
    const doRetry = (runId: string): void => {
        void client.retry(runId).then(refresh).catch(() => {});
    };
    const doClone = (runId: string): void => {
        void client
            .clone(runId)
            .then(id => {
                selectedB.setValue(id);
                refresh();
            })
            .catch(() => {});
    };

    // ── roster (left) ──
    const runRow = (r: TCNSDurableRunView, sel: boolean): TExoSchema => (
        <div
            static={{
                style:
                    `padding:11px 12px;border-bottom:1px solid var(--border-primary);cursor:pointer;` +
                    `display:flex;align-items:center;gap:10px;` +
                    (sel
                        ? 'background:var(--bg-panel);border-left:3px solid var(--blood-bright);padding-left:9px'
                        : ''),
            }}
            handlers={{ onClick: () => selectedB.setValue(r.runId) }}
        >
            <span
                static={{
                    style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:12px',
                }}
            >
                {r.runId}
            </span>
            {badge(r.status)}
        </div>
    );

    const rosterRegion = (): TExoSchema => {
        const runs = runsB.getValue();
        const sel = selectedB.getValue();
        if (!runs.length)
            return (
                <div static={{ style: 'padding:24px;color:var(--text-muted)' }}>
                    no runs yet
                </div>
            );
        return (
            <div static={{ children: runs.map(r => runRow(r, r.runId === sel)) }} />
        );
    };

    // ── detail (right) ──
    const taskRow = (t: TCNSDurableRunView['attempts'][number]['tasks'][number]): TExoSchema => {
        const failed = t.status === 'failed';
        return (
            <div
                static={{
                    style:
                        `display:flex;align-items:flex-start;gap:10px;padding:8px 12px;` +
                        `border-bottom:1px dashed var(--border-primary);` +
                        (failed ? 'background:rgba(139,38,53,.10)' : ''),
                }}
            >
                <span
                    static={{
                        style: `width:16px;text-align:center;color:${failed ? 'var(--text-error)' : 'var(--text-success)'}`,
                    }}
                >
                    {failed ? '✗' : '✓'}
                </span>
                <div static={{ style: 'flex:1;min-width:0' }}>
                    <span static={{ style: 'color:var(--text-muted);font-size:11px' }}>
                        [{String(t.index)}]
                    </span>{' '}
                    <span static={{ style: 'color:var(--text-primary)' }}>
                        {t.neuronName}
                    </span>{' '}
                    <span static={{ style: 'color:var(--text-muted);font-size:12px' }}>
                        {t.output ? `→ ${t.output.collateralName}` : '→ ✗ threw'}
                    </span>
                    {t.output
                        ? (
                              <div static={{ style: 'color:var(--bone-medium);font-size:11px;margin-top:3px;white-space:pre-wrap;word-break:break-word' }}>
                                  {pp(t.output.payload)}
                              </div>
                          )
                        : ''}
                    {t.error
                        ? (
                              <div static={{ style: 'color:var(--text-error);font-size:12px;margin-top:3px;border-left:2px solid var(--infection-red);padding-left:8px' }}>
                                  ⚠ {t.error}
                              </div>
                          )
                        : ''}
                </div>
            </div>
        );
    };

    const attemptBlock = (a: TCNSDurableRunView['attempts'][number]): TExoSchema => (
        <div
            static={{
                style:
                    `border:1px solid ${a.status === 'failed' ? 'var(--border-infected)' : 'var(--border-primary)'};` +
                    'margin-bottom:14px;background:var(--bg-panel)',
            }}
        >
            <div
                static={{
                    style: 'padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border-primary);background:var(--bg-card)',
                }}
            >
                <span static={{ style: 'color:var(--bone-white);letter-spacing:1px' }}>
                    ATTEMPT #{String(a.attemptNumber)}
                </span>
                {badge(a.status)}
                <span static={{ style: 'color:var(--text-muted);font-size:11px;margin-left:auto' }}>
                    {String(a.hopCount)} hops
                </span>
            </div>
            <div static={{ children: a.tasks.map(taskRow) }} />
        </div>
    );

    const detailRegion = (): TExoSchema => {
        const runs = runsB.getValue();
        const sel = selectedB.getValue();
        const r = runs.find(x => x.runId === sel);
        if (!r)
            return (
                <div static={{ style: 'color:var(--text-muted);text-align:center;margin-top:60px;letter-spacing:1px' }}>
                    select a run
                </div>
            );
        const canRetry = r.status === 'failed';
        const btn = (label: string, on: () => void, accent: boolean, disabled?: boolean): TExoSchema => (
            <button
                static={{
                    style:
                        `font-family:var(--font-primary);font-size:12px;letter-spacing:1px;text-transform:uppercase;` +
                        `padding:7px 12px;background:var(--bg-card);` +
                        `border:1px solid ${accent ? 'var(--infection-yellow)' : 'var(--border-accent)'};` +
                        `color:${accent ? 'var(--text-warning)' : 'var(--text-primary)'};` +
                        (disabled ? 'opacity:.4;cursor:not-allowed' : 'cursor:pointer'),
                }}
                handlers={{ onClick: () => { if (!disabled) on(); } }}
            >
                {label}
            </button>
        );
        return (
            <div>
                <div static={{ style: 'display:flex;align-items:center;gap:12px;margin-bottom:4px' }}>
                    <h2 static={{ style: 'margin:0;font-size:16px;color:var(--bone-light);letter-spacing:1px;word-break:break-all' }}>
                        {r.runId}
                    </h2>
                    {badge(r.status)}
                </div>
                <div static={{ style: 'color:var(--text-muted);font-size:12px;margin-bottom:6px' }}>
                    entry: {r.entry.collateralName} ← {pp(r.entry.payload)}
                </div>
                <div static={{ style: 'color:var(--text-warning);font-size:12px;margin-bottom:18px' }}>
                    {r.frontier.length
                        ? `frontier (resumable): ${r.frontier.join(', ')}`
                        : 'frontier: — (settled)'}
                </div>
                <div static={{ children: r.attempts.map(attemptBlock) }} />
                <div static={{ style: 'margin-top:16px;display:flex;gap:10px' }}>
                    {btn('Retry (resume frontier)', () => doRetry(r.runId), true, !canRetry)}
                    {btn('Clone (fresh run from entry)', () => doClone(r.runId), false)}
                </div>
            </div>
        );
    };

    // ── layout ──
    return (
        <div
            static={{
                style: 'flex:1;display:flex;flex-direction:column;min-height:0;font-family:var(--font-primary)',
                onExoMount: () => {
                    refresh();
                    client
                        .info()
                        .then(i => backendB.setValue(i.backend))
                        .catch(() => backendB.setValue('unknown'));
                    timer = setInterval(refresh, POLL_MS);
                },
                onExoUnmount: () => {
                    if (timer) clearInterval(timer);
                    timer = null;
                },
            }}
        >
            <div
                static={{
                    style: 'padding:14px 18px;border-bottom:2px solid var(--border-infected);display:flex;align-items:baseline;gap:14px',
                }}
            >
                <h1 static={{ style: 'margin:0;font-size:22px;letter-spacing:2px;color:var(--blood-bright)' }}>
                    {icon} {title}
                </h1>
                <span
                    static={{ style: 'color:var(--text-muted);font-size:12px' }}
                    bindable={{ children: combine([backendB], () => `backend: ${backendB.getValue()} · polling ${POLL_MS / 1000}s`) }}
                />
            </div>
            <div static={{ style: 'flex:1;display:grid;grid-template-columns:340px 1fr;min-height:0' }}>
                <div static={{ style: 'border-right:2px solid var(--border-primary);background:var(--bg-secondary);display:flex;flex-direction:column;min-height:0' }}>
                    {canLaunch
                        ? (
                              <div static={{ style: 'padding:12px;border-bottom:1px solid var(--border-primary);display:flex;gap:8px;flex-wrap:wrap' }}>
                                  <button
                                      static={{ style: 'font-family:var(--font-primary);font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:7px 12px;cursor:pointer;background:var(--flesh-medium);border:1px solid var(--border-infected);color:var(--bone-white)' }}
                                      handlers={{ onClick: () => doLaunch(true) }}
                                  >
                                      Launch (fails)
                                  </button>
                                  <button
                                      static={{ style: 'font-family:var(--font-primary);font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:7px 12px;cursor:pointer;background:var(--bg-card);border:1px solid var(--border-accent);color:var(--text-primary)' }}
                                      handlers={{ onClick: () => doLaunch(false) }}
                                  >
                                      Launch (ok)
                                  </button>
                              </div>
                          )
                        : ''}
                    <div
                        static={{ style: 'overflow-y:auto;flex:1' }}
                        bindable={{ children: combine([runsB, selectedB], rosterRegion) }}
                    />
                </div>
                <div
                    static={{ style: 'overflow-y:auto;padding:18px 22px;min-height:0' }}
                    bindable={{ children: combine([runsB, selectedB], detailRegion) }}
                />
            </div>
        </div>
    );
}
