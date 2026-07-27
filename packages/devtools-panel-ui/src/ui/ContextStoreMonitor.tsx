import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';

// Native Exodra port. TODO(protocol-migration): the Context Store Monitor was
// built on the per-response `contexts` map of the old StimulationResponse DTO.
// The @cnstra/devtools-dto protocol models each step as a CNSDTOHop, which has NO
// `contexts` field, so there is no data source for context tracking. Rather than
// fabricate data, this panel is degraded to a "not available" placeholder.

const PANEL_STYLE =
    'background:var(--bg-panel);border:2px solid var(--border-infected);' +
    'border-radius:var(--radius-sm);padding:var(--spacing-sm);' +
    'font-size:var(--font-size-xs);color:var(--text-primary);' +
    'font-family:var(--font-primary);box-shadow:0 0 10px var(--shadow-infection);width:100%';

const EMPTY_STYLE =
    'background:var(--bg-panel);border:2px solid var(--border-primary);' +
    'border-radius:var(--radius-sm);padding:var(--spacing-sm);' +
    'font-size:var(--font-size-xs);color:var(--text-muted);text-align:center';

export function contextStoreMonitor(
    selectedAppId: TExoBindable<string | null, string | null>
): TExoSchema {
    const isExpanded = bindable(false);

    const placeholder = (): TExoSchema => (
        <div static={{ style: EMPTY_STYLE }}>
            🧮 Select an app to monitor context store
        </div>
    );

    const panel = (expanded: boolean): TExoSchema => (
        <div static={{ style: PANEL_STYLE }}>
            <div
                static={{
                    style:
                        'display:flex;justify-content:space-between;align-items:center;' +
                        `margin-bottom:${expanded ? 'var(--spacing-sm)' : '0'};cursor:pointer`,
                }}
                handlers={{ onClick: () => isExpanded.setValue(!isExpanded.getValue()) }}
            >
                <span static={{ style: 'color:var(--infection-blue)' }}>
                    🧮 Context Store Monitor
                </span>
                <span static={{ style: 'color:var(--text-muted)' }}>
                    {expanded ? '▼' : '▶'}
                </span>
            </div>
            {expanded ? (
                <div
                    static={{
                        style: 'display:flex;flex-direction:column;gap:var(--spacing-xs);color:var(--text-muted);font-size:10px;line-height:1.5',
                    }}
                >
                    <div static={{ style: 'color:var(--infection-yellow)' }}>
                        ⚠️ Context tracking is not available in this protocol.
                    </div>
                    <div>
                        The current @cnstra/devtools-dto protocol models execution
                        as per-neuron hops, which do not carry a context store.
                        There is no context data to display.
                    </div>
                </div>
            ) : (
                <div static={{ style: 'color:var(--text-muted)' }}>
                    ⚠️ Not available in this protocol
                </div>
            )}
        </div>
    );

    const content = combine([selectedAppId, isExpanded], () =>
        selectedAppId.getValue() ? panel(isExpanded.getValue()) : placeholder()
    );

    return <div bindable={{ children: content }} />;
}
