import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import { safeStringify } from '../utils/safeJson';

// Native Exodra port of the React <JsonViewer>. A collapsible JSON preview: a
// primitive renders inline; an object/array renders a click-to-expand header with a
// full pretty-printed <pre>. Coexists with the React JsonViewer.tsx until the last
// React island that uses it is ported.

interface JsonViewOpts {
    defaultExpanded?: boolean;
    maxHeight?: string;
}

const isComplex = (obj: unknown): boolean => {
    if (obj === null || obj === undefined) return false;
    const t = typeof obj;
    if (t === 'string' || t === 'number' || t === 'boolean') return false;
    return Array.isArray(obj) || t === 'object';
};

export function jsonView(data: unknown, opts: JsonViewOpts = {}): TExoSchema {
    if (!isComplex(data)) {
        return (
            <div static={{ style: 'font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--text-muted);font-style:italic' }}>
                {data === null ? 'null' : data === undefined ? 'undefined' : String(data)}
            </div>
        );
    }

    const maxHeight = opts.maxHeight ?? '300px';
    const expandedB = bindable(opts.defaultExpanded ?? false);
    const preview = (): string => {
        const s = safeStringify(data);
        return s.length > 80 ? s.slice(0, 80) + '...' : s;
    };

    const view = (expanded: boolean): TExoSchema => (
        <div static={{ style: 'border:1px solid var(--border-accent);border-radius:var(--radius-sm);background:var(--bg-card);margin:var(--spacing-xs) 0' }}>
            <div
                static={{ style: `display:flex;align-items:center;gap:var(--spacing-xs);padding:var(--spacing-xs) var(--spacing-sm);border-bottom:${expanded ? '1px solid var(--border-accent)' : 'none'};cursor:pointer;background:var(--bg-subtle)` }}
                handlers={{ onClick: () => expandedB.setValue(!expandedB.getValue()) }}
            >
                <span static={{ style: `font-size:var(--font-size-xs);color:var(--text-muted);transform:${expanded ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform 0.2s ease;flex-shrink:0` }}>▶</span>
                <div static={{ style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }}>
                    <span static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted)' }}>{expanded ? 'Click to collapse' : preview()}</span>
                </div>
                <div static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted);flex-shrink:0' }}>{expanded ? '−' : '+'}</div>
            </div>
            {expanded ? (
                <div static={{ style: `padding:var(--spacing-sm);max-height:${maxHeight};overflow:auto;background:var(--bg-card)` }}>
                    <pre static={{ style: 'font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--text-primary);margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word' }}>{safeStringify(data, 2)}</pre>
                </div>
            ) : (
                <div />
            )}
        </div>
    );

    return <div bindable={{ children: combine([expandedB], () => view(expandedB.getValue())) }} />;
}
