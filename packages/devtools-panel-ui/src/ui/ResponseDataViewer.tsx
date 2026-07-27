import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine, readEntityByPk, subscribeEntityByPk } from '../exo/oimdb-bind';
import { db } from '../model';
import { responseUIStateHelpers } from '../cns/data-layer/ui-state/UIStateNeuron';
import { jsonView } from './json-view';

// Native Exodra port of the React <ResponseDataViewer>. Shows a response's
// input/output payloads (via jsonView) in a collapsible card. Expand state persists
// per `responseId` through db.responseUIState (toggled via the CNS data layer);
// without a responseId it uses a local bindable.

type Data = {
    inputPayload?: unknown;
    outputPayload?: unknown;
    snapshot?: unknown;
};
type Opts = { title?: string; defaultExpanded?: boolean; responseId?: string };

const SECTION =
    'border:1px solid var(--border-accent);border-radius:var(--radius-xs);padding:var(--spacing-xs);background:var(--bg-primary)';
const SECTION_H =
    'font-size:var(--font-size-xs);font-weight:bold;color:var(--text-secondary);margin-bottom:var(--spacing-xs);display:flex;align-items:center;gap:var(--spacing-xs)';

export function responseDataViewer(data: Data, opts: Opts = {}): TExoSchema {
    const title = opts.title ?? 'Response Data';
    const defaultExpanded = opts.defaultExpanded ?? false;
    const responseId = opts.responseId;

    const hasData =
        data.inputPayload !== undefined ||
        data.outputPayload !== undefined ||
        data.snapshot !== undefined;
    if (!hasData)
        return <div static={{ style: 'font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--text-muted);font-style:italic;padding:var(--spacing-sm)' }}>No data available</div>;

    const expandedB = bindable(defaultExpanded);
    if (responseId) {
        const sync = (): void => {
            const s = readEntityByPk(db.responseUIState, responseId) as
                | { isExpanded?: boolean }
                | undefined;
            expandedB.setValue(s?.isExpanded ?? defaultExpanded);
        };
        sync();
        subscribeEntityByPk(db.responseUIState, responseId, sync);
    }
    const toggle = (): void => {
        if (responseId) responseUIStateHelpers.toggleExpanded(responseId);
        else expandedB.setValue(!expandedB.getValue());
    };

    const payloadSection = (icon: string, payload: unknown): TExoSchema => (
        <div static={{ style: SECTION }}>
            <div static={{ style: SECTION_H }}>{icon}</div>
            {jsonView(payload, { maxHeight: '200px' })}
        </div>
    );

    const body = (expanded: boolean): TExoSchema => (
        <div static={{ style: 'border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-card);overflow:hidden' }}>
            <div
                static={{ style: 'display:flex;align-items:center;justify-content:space-between;padding:var(--spacing-sm);background:var(--bg-secondary);border-bottom:1px solid var(--border-primary);cursor:pointer' }}
                handlers={{ onClick: toggle }}
            >
                <div static={{ style: 'font-size:var(--font-size-sm);font-weight:bold;color:var(--text-primary)' }}>📊 {title}</div>
                <div static={{ style: `font-size:var(--font-size-xs);color:var(--text-muted);transform:${expanded ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform 0.2s ease` }}>▼</div>
            </div>
            {expanded ? (
                <div static={{ style: 'padding:var(--spacing-sm)' }}>
                    <div static={{ style: 'display:flex;flex-direction:column;gap:var(--spacing-sm)' }}>
                        {data.inputPayload !== undefined ? payloadSection('📥 Input Signal', data.inputPayload) : <div />}
                        {data.outputPayload !== undefined ? payloadSection('📤 Output Signal', data.outputPayload) : <div />}
                        {data.snapshot !== undefined ? payloadSection('📸 Data Snapshot', data.snapshot) : <div />}
                    </div>
                </div>
            ) : (
                <div />
            )}
        </div>
    );

    return <div bindable={{ children: combine([expandedB], () => body(expandedB.getValue())) }} />;
}
