import React, { useState } from 'react';
import { JsonViewer } from './JsonViewer';
import { safeStringify } from '../utils/safeJson';
import { db } from '../model';
import { useSelectEntityByPk } from '@oimdb/react';
import { responseUIStateHelpers } from '../cns/data-layer/ui-state/UIStateNeuron';

interface ResponseDataViewerProps {
    data: {
        inputPayload?: unknown;
        outputPayload?: unknown;
        responsePayload?: unknown;
        contexts?: Record<string, unknown>;
        snapshot?: unknown;
    };
    title?: string;
    defaultExpanded?: boolean;
    responseId?: string; // Optional responseId for persistent state
}

export const ResponseDataViewer: React.FC<ResponseDataViewerProps> = ({
    data,
    title = 'Response Data',
    defaultExpanded = false,
    responseId,
}) => {
    // Use persistent state from collection if responseId is provided
    const uiState = responseId
        ? useSelectEntityByPk(db.responseUIState, responseId)
        : null;

    // Local state for cases without responseId
    const [localExpanded, setLocalExpanded] = useState(defaultExpanded);

    const isExpanded = responseId
        ? uiState?.isExpanded ?? defaultExpanded
        : localExpanded;

    const handleToggle = () => {
        if (responseId) {
            responseUIStateHelpers.toggleExpanded(responseId);
        } else {
            setLocalExpanded(!localExpanded);
        }
    };

    const hasData =
        data.inputPayload !== undefined ||
        data.outputPayload !== undefined ||
        data.responsePayload !== undefined ||
        data.contexts !== undefined ||
        data.snapshot !== undefined;

    // Use outputPayload or responsePayload for output signal
    const outputPayload = data.outputPayload ?? data.responsePayload;

    if (!hasData) {
        return (
            <div
                style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                    padding: 'var(--spacing-sm)',
                }}
            >
                No data available
            </div>
        );
    }

    return (
        <div
            style={{
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--spacing-sm)',
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-primary)',
                    cursor: 'pointer',
                }}
                onClick={handleToggle}
            >
                <div
                    style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'bold',
                        color: 'var(--text-primary)',
                    }}
                >
                    📊 {title}
                </div>
                <div
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-muted)',
                        transform: isExpanded
                            ? 'rotate(180deg)'
                            : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                    }}
                >
                    ▼
                </div>
            </div>

            {/* Content */}
            {isExpanded && (
                <div style={{ padding: 'var(--spacing-sm)' }}>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-sm)',
                        }}
                    >
                        {/* Input Signal */}
                        {data.inputPayload !== undefined && (
                            <div
                                style={{
                                    border: '1px solid var(--border-accent)',
                                    borderRadius: 'var(--radius-xs)',
                                    padding: 'var(--spacing-xs)',
                                    background: 'var(--bg-primary)',
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        fontWeight: 'bold',
                                        color: 'var(--text-secondary)',
                                        marginBottom: 'var(--spacing-xs)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-xs)',
                                    }}
                                >
                                    📥 Input Signal
                                </div>
                                <JsonViewer
                                    data={data.inputPayload}
                                    title=""
                                    defaultExpanded={false}
                                    maxHeight="200px"
                                />
                            </div>
                        )}

                        {/* Output Signal */}
                        {outputPayload !== undefined && (
                            <div
                                style={{
                                    border: '1px solid var(--border-accent)',
                                    borderRadius: 'var(--radius-xs)',
                                    padding: 'var(--spacing-xs)',
                                    background: 'var(--bg-primary)',
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        fontWeight: 'bold',
                                        color: 'var(--text-secondary)',
                                        marginBottom: 'var(--spacing-xs)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-xs)',
                                    }}
                                >
                                    📤 Output Signal
                                </div>
                                <JsonViewer
                                    data={outputPayload}
                                    title=""
                                    defaultExpanded={false}
                                    maxHeight="200px"
                                />
                            </div>
                        )}

                        {/* Context Storage */}
                        {data.contexts !== undefined && (
                            <div
                                style={{
                                    border: '1px solid var(--border-accent)',
                                    borderRadius: 'var(--radius-xs)',
                                    padding: 'var(--spacing-xs)',
                                    background: 'var(--bg-primary)',
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        fontWeight: 'bold',
                                        color: 'var(--text-secondary)',
                                        marginBottom: 'var(--spacing-xs)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-xs)',
                                    }}
                                >
                                    🧠 Context Storage
                                </div>
                                <JsonViewer
                                    data={data.contexts}
                                    title=""
                                    defaultExpanded={false}
                                    maxHeight="200px"
                                />
                            </div>
                        )}

                        {/* Data Snapshot */}
                        {data.snapshot !== undefined && (
                            <div
                                style={{
                                    border: '1px solid var(--border-accent)',
                                    borderRadius: 'var(--radius-xs)',
                                    padding: 'var(--spacing-xs)',
                                    background: 'var(--bg-primary)',
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        fontWeight: 'bold',
                                        color: 'var(--text-secondary)',
                                        marginBottom: 'var(--spacing-xs)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-xs)',
                                    }}
                                >
                                    📸 Data Snapshot
                                </div>
                                <JsonViewer
                                    data={data.snapshot}
                                    title=""
                                    defaultExpanded={false}
                                    maxHeight="400px"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
