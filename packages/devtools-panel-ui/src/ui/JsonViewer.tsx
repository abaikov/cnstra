import React, { useState } from 'react';
import { safeStringify } from '../utils/safeJson';

interface JsonViewerProps {
    data: any;
    title?: string;
    defaultExpanded?: boolean;
    maxHeight?: string;
}

export const JsonViewer: React.FC<JsonViewerProps> = ({
    data,
    title,
    defaultExpanded = false,
    maxHeight = '300px',
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const formatJson = (obj: any): string => {
        return safeStringify(obj, 2);
    };

    const getPreview = (obj: any): string => {
        const str = safeStringify(obj);
        return str.length > 80 ? str.substring(0, 80) + '...' : str;
    };

    const hasComplexData = (obj: any): boolean => {
        if (obj === null || obj === undefined) return false;
        if (
            typeof obj === 'string' ||
            typeof obj === 'number' ||
            typeof obj === 'boolean'
        )
            return false;
        // Arrays and objects (even empty ones) should use collapsible view for consistency
        if (Array.isArray(obj) || (typeof obj === 'object' && obj !== null))
            return true;
        return false;
    };

    if (!hasComplexData(data)) {
        // Only for primitives - null, undefined, string, number, boolean
        return (
            <div
                style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                }}
            >
                {data === null
                    ? 'null'
                    : data === undefined
                    ? 'undefined'
                    : String(data)}
            </div>
        );
    }

    return (
        <div
            style={{
                border: '1px solid var(--border-accent)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-card)',
                margin: 'var(--spacing-xs) 0',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-xs)',
                    padding: 'var(--spacing-xs) var(--spacing-sm)',
                    borderBottom: isExpanded
                        ? '1px solid var(--border-accent)'
                        : 'none',
                    cursor: 'pointer',
                    background: 'var(--bg-subtle)',
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <span
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        transform: isExpanded
                            ? 'rotate(90deg)'
                            : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                        flexShrink: 0,
                    }}
                >
                    ▶
                </span>
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {isExpanded ? (
                        <span
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            Click to collapse
                        </span>
                    ) : (
                        <span
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            {getPreview(data)}
                        </span>
                    )}
                </div>
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        flexShrink: 0,
                    }}
                >
                    {isExpanded ? '−' : '+'}
                </div>
            </div>
            {isExpanded && (
                <div
                    style={{
                        padding: 'var(--spacing-sm)',
                        maxHeight,
                        overflow: 'auto',
                        background: 'var(--bg-card)',
                    }}
                >
                    <pre
                        style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-primary)',
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                        }}
                    >
                        {formatJson(data)}
                    </pre>
                </div>
            )}
        </div>
    );
};
