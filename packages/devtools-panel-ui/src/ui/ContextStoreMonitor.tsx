import React, { useState } from 'react';

interface Props {
    selectedAppId: string | null;
}

// TODO(protocol-migration): The Context Store Monitor was built entirely on the
// per-response `contexts` map that the old StimulationResponse DTO carried. The
// new @cnstra/devtools-dto protocol models each step as a CNSDTOHop, which has
// NO `contexts` field (and stimulations no longer expose accumulated context
// either). There is therefore no data source for context tracking in this
// protocol. Rather than fabricate data, this panel is degraded to a
// "not available" placeholder. Re-implement if/when a context feed is
// reintroduced to the protocol.
export const ContextStoreMonitor: React.FC<Props> = ({ selectedAppId }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!selectedAppId) {
        return (
            <div
                style={{
                    background: 'var(--bg-panel)',
                    border: '2px solid var(--border-primary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--spacing-sm)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                }}
            >
                🧮 Select an app to monitor context store
            </div>
        );
    }

    return (
        <div
            style={{
                background: 'var(--bg-panel)',
                border: '2px solid var(--border-infected)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--spacing-sm)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-primary)',
                boxShadow: '0 0 10px var(--shadow-infection)',
                width: '100%',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: isExpanded ? 'var(--spacing-sm)' : '0',
                    cursor: 'pointer',
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <span style={{ color: 'var(--infection-blue)' }}>
                    🧮 Context Store Monitor
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                    {isExpanded ? '▼' : '▶'}
                </span>
            </div>

            {!isExpanded ? (
                <div style={{ color: 'var(--text-muted)' }}>
                    ⚠️ Not available in this protocol
                </div>
            ) : (
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--spacing-xs)',
                        color: 'var(--text-muted)',
                        fontSize: '10px',
                        lineHeight: 1.5,
                    }}
                >
                    <div style={{ color: 'var(--infection-yellow)' }}>
                        ⚠️ Context tracking is not available in this protocol.
                    </div>
                    <div>
                        The current @cnstra/devtools-dto protocol models
                        execution as per-neuron hops, which do not carry a
                        context store. There is no context data to display.
                    </div>
                </div>
            )}
        </div>
    );
};
