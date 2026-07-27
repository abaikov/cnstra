import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';
import {
    combine,
    readEntitiesByIndexKey,
    subscribeEntitiesByIndexKey,
} from '../exo/oimdb-bind';
import { db } from '../model';
import type { TStimulation } from '../model';
import { jsonView } from './json-view';
import { safeStringify } from '../utils/safeJson';
import type { CNSDTOReplayStartMessage } from '@cnstra/devtools-dto';
import type { DevtoolsSocket } from '../app/controllers/socket';

// Native Exodra port of the React <SignalDebugger> island. Form inputs are
// UNCONTROLLED (read by `name` from the form container on inject; "Copy" writes the
// DOM value directly) — that avoids the rebuild-on-keystroke focus loss a controlled
// input would hit in Exodra's rebuild model. The recent-stimulations and injection-
// history lists are separate reactive regions, so their updates never touch the form.

type Injection = {
    timestamp: number;
    collateralName: string;
    payload: unknown;
    success: boolean;
    error?: string;
};

type Collateral = { id: string; name: string };

const notNull = <T,>(a: readonly (T | undefined)[]): T[] =>
    a.filter((x): x is T => x != null);

const PANEL =
    'background:var(--bg-panel);border:2px solid var(--border-infected);border-radius:var(--radius-sm);' +
    'padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-primary);' +
    'font-family:var(--font-primary);box-shadow:0 0 10px var(--shadow-infection);width:100%';
const EMPTY =
    'background:var(--bg-panel);border:2px solid var(--border-primary);border-radius:var(--radius-sm);' +
    'padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-muted);text-align:center';
const LABEL = 'display:block;margin-bottom:2px;font-size:10px;color:var(--text-muted)';
const FIELD =
    'width:100%;padding:4px;font-size:10px;background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:2px;color:var(--text-primary)';
const SECTION_H = 'margin-bottom:var(--spacing-xs);font-size:11px;font-weight:bold';

export function signalDebugger(
    socket: DevtoolsSocket,
    appIdB: TExoBindable<string | null, string | null>,
    cnsIdB: TExoBindable<string | null, string | null>
): TExoSchema {
    const isExpanded = bindable(false);
    const history = bindable<Injection[]>([]);
    const collateralsB = bindable<Collateral[]>([]);
    const stimsB = bindable<TStimulation[]>([]);

    let formEl: HTMLElement | null = null;
    let chosenCol = '';

    let unsubs: Array<() => void> = [];
    const read = (): void => {
        const id = appIdB.getValue() || 'dummy-id';
        collateralsB.setValue(
            notNull(
                readEntitiesByIndexKey(db.collaterals, db.collaterals.indexes.appId, id)
            ) as Collateral[]
        );
        stimsB.setValue(
            notNull(
                readEntitiesByIndexKey(db.stimulations, db.stimulations.indexes.appId, id)
            )
                .slice()
                .sort((a, b) => b.startedAt - a.startedAt)
                .slice(0, 10)
        );
    };
    const wire = (): void => {
        for (const u of unsubs) u();
        unsubs = [];
        const id = appIdB.getValue() || 'dummy-id';
        read();
        unsubs.push(
            subscribeEntitiesByIndexKey(db.collaterals, db.collaterals.indexes.appId, id, read),
            subscribeEntitiesByIndexKey(db.stimulations, db.stimulations.indexes.appId, id, read)
        );
    };
    appIdB.subscribe(wire);
    wire();

    const colNameById = (id: string): string =>
        db.collaterals.getOneByPk(id)?.name ?? id;
    const field = (name: string): string =>
        (formEl?.querySelector(`[name="${name}"]`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLSelectElement
            | null)?.value ?? '';
    const setField = (name: string, val: string): void => {
        const el = formEl?.querySelector(`[name="${name}"]`) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLSelectElement
            | null;
        if (el) el.value = val;
    };
    const pushHistory = (entry: Injection): void =>
        history.setValue([entry, ...history.getValue().slice(0, 19)]);

    const inject = (): void => {
        const collateralName = field('collateral');
        const appId = appIdB.getValue();
        if (!socket.wsRef.current || !appId || !collateralName) {
            pushHistory({
                timestamp: Date.now(),
                collateralName,
                payload: field('payload'),
                success: false,
                error: 'Missing WebSocket connection, app selection, or collateral name',
            });
            return;
        }
        try {
            const payloadStr = field('payload');
            const optionsStr = field('options');
            const payload = payloadStr ? JSON.parse(payloadStr) : undefined;
            const options = optionsStr ? JSON.parse(optionsStr) : undefined;
            const cnsIds = (db.cns.indexes.appId.getPksByKey(appId) ||
                new Set()) as Set<string>;
            const singleCnsId =
                cnsIdB.getValue() ||
                (cnsIds.size === 1 ? Array.from(cnsIds)[0] : undefined);
            const targetCol = collateralsB
                .getValue()
                .find(c => c.name === collateralName);
            // No fresh-stimulate command in the protocol; closest is replay.start
            // with an empty source stimulationId (see @cnstra/devtools-dto). contexts
            // has no equivalent and is dropped.
            const cmd: CNSDTOReplayStartMessage = {
                type: 'replay.start',
                replayId: `debug-${Date.now()}`,
                stimulationId: '',
                collateralId: targetCol?.id ?? collateralName,
                payload,
                appId,
                ...(singleCnsId ? { cnsId: singleCnsId } : {}),
                ...(options ? { options } : {}),
            };
            socket.wsRef.current.send(JSON.stringify(cmd));
            pushHistory({ timestamp: Date.now(), collateralName, payload, success: true });
        } catch (e) {
            pushHistory({
                timestamp: Date.now(),
                collateralName,
                payload: field('payload'),
                success: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            });
        }
    };

    const copy = (stim: TStimulation): void => {
        chosenCol = colNameById(stim.collateralId);
        setField('collateral', chosenCol);
        setField('payload', safeStringify(stim.payload || {}, 2));
        setField('contexts', '{}');
        setField('options', '{}');
    };

    const collateralSelect = (): TExoSchema => (
        <select
            static={{ name: 'collateral', style: FIELD }}
            handlers={{ onChange: (e: Event) => { chosenCol = (e.target as HTMLSelectElement).value; } }}
        >
            <option static={{ value: '', selected: chosenCol === '' }}>Select collateral...</option>
            {collateralsB.getValue().map(col => (
                <option static={{ value: col.name, selected: col.name === chosenCol }}>{col.name}</option>
            ))}
        </select>
    );

    const recentList = (): TExoSchema => {
        const stims = stimsB.getValue();
        if (stims.length === 0)
            return <div static={{ style: 'color:var(--text-muted);font-style:italic;text-align:center' }}>No recent stimulations found</div>;
        return (
            <div>
                {stims.map(stim => (
                    <div static={{ style: 'background:var(--bg-secondary);border:1px solid var(--border-primary);border-radius:2px;padding:4px;margin-bottom:4px;font-size:9px' }}>
                        <div static={{ style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:2px' }}>
                            <span static={{ style: 'color:var(--infection-green)' }}>{colNameById(stim.collateralId)}</span>
                            <button static={{ style: 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:8px;padding:2px' }} handlers={{ onClick: () => copy(stim) }}>📋 Copy</button>
                        </div>
                        <div static={{ style: 'color:var(--text-muted)' }}>{new Date(stim.startedAt).toLocaleTimeString()} | from: {db.collaterals.getOneByPk(stim.collateralId)?.neuronId ?? '-'}</div>
                        {jsonView(stim.payload || {})}
                    </div>
                ))}
            </div>
        );
    };

    const historyList = (): TExoSchema => {
        const items = history.getValue();
        if (items.length === 0) return <div />;
        return (
            <div static={{ style: 'border-top:1px solid var(--border-primary);padding-top:var(--spacing-sm)' }}>
                <div static={{ style: `${SECTION_H};color:var(--infection-yellow)` }}>📊 Injection History</div>
                <div static={{ style: 'max-height:80px;overflow-y:auto' }}>
                    {items.map(inj => (
                        <div static={{ style: `background:${inj.success ? 'var(--bg-secondary)' : 'rgba(255,0,0,0.1)'};border:1px solid ${inj.success ? 'var(--border-primary)' : 'var(--infection-red)'};border-radius:2px;padding:4px;margin-bottom:2px;font-size:9px` }}>
                            <div static={{ style: 'display:flex;justify-content:space-between;align-items:center' }}>
                                <span static={{ style: `color:${inj.success ? 'var(--infection-green)' : 'var(--infection-red)'}` }}>{inj.success ? '✅' : '❌'} {inj.collateralName}</span>
                                <span static={{ style: 'color:var(--text-muted)' }}>{new Date(inj.timestamp).toLocaleTimeString()}</span>
                            </div>
                            {inj.error ? <div static={{ style: 'color:var(--infection-red);font-size:8px' }}>Error: {inj.error}</div> : <div />}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const expandedView = (): TExoSchema => (
        <div static={{ style: 'display:flex;flex-direction:column;gap:var(--spacing-sm)', onExoMount: (n: { element: unknown }) => { formEl = n.element as HTMLElement; } }}>
            <div>
                <div static={{ style: `${SECTION_H};color:var(--infection-red)` }}>💉 Signal Injection</div>
                <div static={{ style: 'margin-bottom:var(--spacing-xs)' }}>
                    <label static={{ style: LABEL }}>Target Collateral:</label>
                    <div bindable={{ children: combine([collateralsB], collateralSelect) }} />
                </div>
                <div static={{ style: 'margin-bottom:var(--spacing-xs)' }}>
                    <label static={{ style: LABEL }}>Payload (JSON):</label>
                    <textarea static={{ name: 'payload', value: '{}', style: `${FIELD};height:40px;resize:vertical;font-family:monospace` }} />
                </div>
                <details static={{ style: 'margin-bottom:var(--spacing-xs)' }}>
                    <summary static={{ style: 'cursor:pointer;font-size:10px;color:var(--text-muted)' }}>Advanced Options</summary>
                    <div static={{ style: 'margin-top:var(--spacing-xs)' }}>
                        <label static={{ style: LABEL }}>Contexts (JSON):</label>
                        <textarea static={{ name: 'contexts', value: '{}', style: `${FIELD};height:30px;font-family:monospace;margin-bottom:var(--spacing-xs)` }} />
                        <label static={{ style: LABEL }}>Options (JSON):</label>
                        <textarea static={{ name: 'options', value: '{}', style: `${FIELD};height:30px;font-family:monospace` }} />
                    </div>
                </details>
                <button static={{ class: 'btn-infected', style: 'width:100%;padding:var(--spacing-sm);font-size:11px;background:var(--infection-red);color:white;border:1px solid var(--infection-red);border-radius:2px;cursor:pointer' }} handlers={{ onClick: inject }}>💉 Inject Signal</button>
            </div>

            <div static={{ style: 'border-top:1px solid var(--border-primary);padding-top:var(--spacing-sm)' }}>
                <div static={{ style: `${SECTION_H};color:var(--infection-blue)` }}>🔍 Recent Stimulations</div>
                <div static={{ style: 'max-height:120px;overflow-y:auto' }} bindable={{ children: combine([stimsB], recentList) }} />
            </div>

            <div bindable={{ children: combine([history], historyList) }} />
        </div>
    );

    const panel = (expanded: boolean): TExoSchema => (
        <div static={{ style: PANEL }}>
            <div
                static={{ style: `display:flex;justify-content:space-between;align-items:center;margin-bottom:${expanded ? 'var(--spacing-sm)' : '0'};cursor:pointer` }}
                handlers={{ onClick: () => isExpanded.setValue(!isExpanded.getValue()) }}
            >
                <span static={{ style: 'color:var(--infection-red)' }}>🔧 Signal Debugger</span>
                <span static={{ style: 'color:var(--text-muted)' }}>{expanded ? '▼' : '▶'}</span>
            </div>
            {expanded ? expandedView() : <div static={{ style: 'font-size:10px;color:var(--text-muted)' }}>Click to expand debugging tools</div>}
        </div>
    );

    const content = combine([isExpanded, appIdB], () =>
        appIdB.getValue()
            ? panel(isExpanded.getValue())
            : <div static={{ style: EMPTY }}>🔧 Select an app to access debugging tools</div>
    );
    return <div bindable={{ children: content }} />;
}
