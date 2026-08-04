import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import type { ICNSDurableStimulationsClient } from '../durable/ICNSDurableStimulationsClient';
import type { TCNSStimulationViewDTO } from '@cnstra/devtools-dto';

// Native Exodra "Durable Runs" admin page — a faithful build of the design
// mockup ("CNStra DevTools — Durable Runs"): bevel/CRT chrome, a striped stimulation
// roster, an attempt strip, and a neuron-by-neuron task waterfall, all under the
// `.dur` scope (see durable-stimulations.css). POLLS the durable-stimulations service
// (ICNSDurableStimulationsClient) every 2s while mounted — stimulations change on a button
// press, not in a stream — and drives Launch / Retry / Clone.

const POLL_MS = 2000;

type TStimView = TCNSStimulationViewDTO;
type TAttempt = TStimView['attempts'][number];
type TTask = TAttempt['tasks'][number];

import { safeStringify as pp } from '../utils/safeJson';

// status → mockup stripe/pill class: d = done, f = failed, r = running/other
const stk = (s: string): 'd' | 'f' | 'r' =>
    s === 'completed' || s === 'done' ? 'd' : s === 'failed' ? 'f' : 'r';
const cvar = (k: 'd' | 'f' | 'r'): string =>
    k === 'd' ? 'var(--pus-green)' : k === 'f' ? 'var(--red)' : 'var(--amber)';

export type StimulationsPageOptions = {
    /** Show the Launch (fails)/(ok) toolbar. Off for pure observability. Default on. */
    canLaunch?: boolean;
    /** Header title. Default "Durable". */
    title?: string;
    /** Header icon. Default "💀". */
    icon?: string;
};

export function stimulationsPage(
    client: ICNSDurableStimulationsClient,
    opts: StimulationsPageOptions = {}
): TExoSchema {
    const canLaunch = opts.canLaunch ?? true;
    const title = opts.title ?? 'Durable';
    const icon = opts.icon ?? '💀';
    const stimulationsB = bindable<TStimView[]>([]);
    const selectedB = bindable<string | null>(null);
    const selAttemptB = bindable<number | null>(null);
    const backendB = bindable<string>('…');
    let timer: ReturnType<typeof setInterval> | null = null;

    // selecting a stimulation resets which attempt the waterfall shows
    const selectStimulation = (id: string | null): void => {
        selectedB.setValue(id);
        selAttemptB.setValue(null);
    };

    const refresh = (): void => {
        client
            .listStimulations()
            .then(rs => {
                stimulationsB.setValue(rs);
                const sel = selectedB.getValue();
                if (rs.length && (sel == null || !rs.some(r => r.stimulationId === sel)))
                    selectStimulation(rs[rs.length - 1].stimulationId);
            })
            .catch(() => {});
    };

    const doLaunch = (fail: boolean): void => {
        void client.launch({ fail }).then(refresh).catch(() => {});
    };
    const doRetry = (stimulationId: string): void => {
        void client.retry(stimulationId).then(refresh).catch(() => {});
    };
    const doClone = (stimulationId: string): void => {
        void client
            .clone(stimulationId)
            .then(id => {
                selectStimulation(id);
                refresh();
            })
            .catch(() => {});
    };

    // ── roster (left) ──
    const stimulationRow = (r: TStimView, sel: boolean): TExoSchema => {
        const k = stk(r.status);
        const meta =
            `${r.attempts.length} att · ` +
            (r.frontier.length ? `frontier ${r.frontier[0]}` : 'settled');
        return (
            <div
                static={{ class: `strow${sel ? ' sel' : ''}` }}
                handlers={{ onClick: () => selectStimulation(r.stimulationId) }}
            >
                <div static={{ class: `stripe ${k}` }} />
                <div static={{ class: 'txt' }}>
                    <div static={{ class: 'id' }}>{r.stimulationId}</div>
                    <div static={{ class: 'meta' }}>{meta}</div>
                </div>
                <div static={{ class: `st ${k}` }}>{r.status}</div>
            </div>
        );
    };

    const rosterRegion = (): TExoSchema => {
        const stimulations = stimulationsB.getValue();
        const sel = selectedB.getValue();
        if (!stimulations.length)
            return (
                <div static={{ class: 'placeholder' }}>
                    <b>no stimulations tracked</b>launch a stimulation to begin
                </div>
            );
        return (
            <div
                static={{ children: stimulations.map(r => stimulationRow(r, r.stimulationId === sel)) }}
            />
        );
    };

    // ── waterfall hop ──
    const hopRow = (t: TTask, front: boolean): TExoSchema => {
        const failed = t.status === 'failed';
        const ms =
            typeof t.duration === 'number' ? `${t.duration}ms` : t.status;
        return (
            <div static={{ class: `hop${failed ? ' err' : ''}${front ? ' front' : ''}` }}>
                <div static={{ class: 'ix' }}>{String(t.index)}</div>
                <div static={{ class: 'nn' }}>{t.neuronName}</div>
                <div static={{ class: 'flow' }}>
                    {t.output
                        ? (
                              <span>
                                  <span static={{ class: 'arr' }}>→</span>{' '}
                                  <em>{t.output.collateralName}</em>
                              </span>
                          )
                        : <span static={{ class: 'x' }}>✗ threw</span>}
                </div>
                <div static={{ class: 'tag' }}>{ms}</div>
                {t.output
                    ? (
                          <div static={{ class: 'payload' }}>
                              {pp(t.output.payload)}
                          </div>
                      )
                    : ''}
                {t.error
                    ? <div static={{ class: 'errline' }}>⚠ {t.error}</div>
                    : ''}
            </div>
        );
    };

    // ── detail (right) ──
    const detailRegion = (): TExoSchema => {
        const stimulations = stimulationsB.getValue();
        const sel = selectedB.getValue();
        const r = stimulations.find(x => x.stimulationId === sel);
        if (!r)
            return (
                <div static={{ class: 'placeholder' }}>
                    <b>no stimulation selected</b>pick a stimulation from the roster
                </div>
            );

        // effective attempt: chosen one if it still exists, else the latest
        const chosen = selAttemptB.getValue();
        const attempt =
            r.attempts.find(a => a.attemptNumber === chosen) ??
            r.attempts[r.attempts.length - 1];
        const frontierSet = new Set(r.frontier);
        const canRetry = r.status === 'failed';

        const step = (a: TAttempt): TExoSchema => {
            const k = stk(a.status);
            const on = attempt && a.attemptNumber === attempt.attemptNumber;
            return (
                <div
                    static={{
                        class: `step${on ? ' sel' : ''}`,
                        style: `--c:${cvar(k)}`,
                    }}
                    handlers={{ onClick: () => selAttemptB.setValue(a.attemptNumber) }}
                >
                    <div static={{ class: 'n' }}>ATTEMPT #{String(a.attemptNumber)}</div>
                    <div static={{ class: 'v' }}>{a.status}</div>
                    <div static={{ class: 't' }}>{String(a.hopCount)} hops</div>
                </div>
            );
        };

        const btn = (
            label: string,
            sub: string,
            fn: () => void,
            primary: boolean,
            disabled?: boolean
        ): TExoSchema => (
            <button
                static={{
                    class: `btn${primary ? ' primary' : ''}`,
                    ...(disabled ? { disabled: true } : {}),
                }}
                handlers={{ onClick: () => { if (!disabled) fn(); } }}
            >
                {label}
                <span static={{ class: 'k' }}>{sub}</span>
            </button>
        );

        return (
            <div static={{ class: 'detail' }}>
                <div static={{ class: 'rtitle' }}>
                    <span static={{ class: 'rid' }}>{r.stimulationId}</span>
                    <span static={{ class: `st ${stk(r.status)}` }}>{r.status}</span>
                </div>

                <div static={{ class: 'entry inset' }}>
                    entry: <b>{r.entry.collateralName}</b> ←{' '}
                    <code>{pp(r.entry.payload)}</code>
                </div>

                {r.frontier.length
                    ? (
                          <div static={{ class: 'frontier' }}>
                              ◈ resumable frontier:{' '}
                              <b>{r.frontier.join(', ')}</b>
                          </div>
                      )
                    : r.status === 'failed'
                      ? <div static={{ class: 'reject' }}>stimulation <b>failed</b> — no outstanding frontier</div>
                      : (
                            <div static={{ style: 'color:var(--bone-md);font-size:12px;padding:2px' }}>
                                frontier: — (settled)
                            </div>
                        )}

                <div static={{ class: 'att' }}>
                    <div static={{ children: r.attempts.map(step) }} />
                </div>

                {attempt
                    ? (
                          <div>
                              <div static={{ class: 'fall-h' }}>
                                  task waterfall · attempt #{String(attempt.attemptNumber)}
                              </div>
                              <div
                                  static={{
                                      class: 'fall',
                                      children: attempt.tasks.map(t =>
                                          hopRow(t, frontierSet.has(t.neuronName))
                                      ),
                                  }}
                              />
                          </div>
                      )
                    : ''}

                <div static={{ class: 'actions' }}>
                    {btn(
                        '↻ Retry',
                        'resume frontier',
                        () => doRetry(r.stimulationId),
                        true,
                        !canRetry
                    )}
                    {btn(
                        '⎘ Clone',
                        'fresh stimulation from entry',
                        () => doClone(r.stimulationId),
                        false
                    )}
                </div>
            </div>
        );
    };

    // ── footer stats ──
    const statsRegion = (): TExoSchema => {
        const stimulations = stimulationsB.getValue();
        const failed = stimulations.filter(r => r.status === 'failed').length;
        const done = stimulations.filter(
            r => r.status === 'completed' || r.status === 'done'
        ).length;
        const stat = (
            num: number,
            lab: string,
            cls: '' | 'bad' | 'good'
        ): TExoSchema => (
            <div static={{ class: `stat${cls ? ' ' + cls : ''}` }}>
                <div static={{ class: 'num' }}>{String(num)}</div>
                <div static={{ class: 'lab' }}>{lab}</div>
            </div>
        );
        return (
            <div
                static={{
                    children: [
                        stat(stimulations.length, 'tracked', ''),
                        stat(failed, 'failed', 'bad'),
                        stat(done, 'done', 'good'),
                    ],
                }}
            />
        );
    };

    // ── layout ──
    return (
        <div
            static={{
                class: 'dur',
                style: 'flex:1;display:flex;flex-direction:column;min-height:0;overflow-y:auto',
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
            <div static={{ class: 'wrap' }}>
                <header static={{ class: 'hdr bevel' }}>
                    <h1>
                        <span static={{ class: 'brain' }}>{icon}</span> {title}
                    </h1>
                    <div static={{ class: 'ctl-bar' }}>
                        <div static={{ class: 'mon', title: 'live durable-stimulations connection' }}>
                            <span static={{ class: 'led2' }} /> Monitoring:{' '}
                            <b
                                bindable={{
                                    children: combine([backendB], () => backendB.getValue()),
                                }}
                            />
                        </div>
                        {canLaunch
                            ? (
                                  <div static={{ class: 'ctl-bar' }}>
                                      <button
                                          static={{ class: 'btn primary' }}
                                          handlers={{ onClick: () => doLaunch(true) }}
                                      >
                                          ▶ Launch (fails)
                                          <span static={{ class: 'k' }}>fire a failing stimulation</span>
                                      </button>
                                      <button
                                          static={{ class: 'btn' }}
                                          handlers={{ onClick: () => doLaunch(false) }}
                                      >
                                          ▶ Launch (ok)
                                          <span static={{ class: 'k' }}>fire a passing stimulation</span>
                                      </button>
                                  </div>
                              )
                            : ''}
                    </div>
                </header>

                <div static={{ class: 'cols' }}>
                    <section static={{ class: 'pane bevel' }}>
                        <div static={{ class: 'pane-h' }}>
                            <span>Stimulations</span>
                            <span
                                static={{ class: 'cnt' }}
                                bindable={{
                                    children: combine(
                                        [stimulationsB],
                                        () => `${stimulationsB.getValue().length} tracked`
                                    ),
                                }}
                            />
                        </div>
                        <div
                            static={{ class: 'roster' }}
                            bindable={{ children: combine([stimulationsB, selectedB], rosterRegion) }}
                        />
                    </section>
                    <section
                        static={{ class: 'pane bevel detail' }}
                        bindable={{
                            children: combine(
                                [stimulationsB, selectedB, selAttemptB],
                                detailRegion
                            ),
                        }}
                    />
                </div>

                <footer static={{ class: 'hud bevel' }}>
                    <div
                        static={{ class: 'stats' }}
                        bindable={{ children: combine([stimulationsB], statsRegion) }}
                    />
                    <div
                        static={{ class: 'ticker' }}
                        bindable={{
                            children: combine(
                                [backendB, stimulationsB],
                                () =>
                                    `> monitoring frontier · backend: ${backendB.getValue()} · polling ${POLL_MS / 1000}s`
                            ),
                        }}
                    />
                </footer>
            </div>
        </div>
    );
}
