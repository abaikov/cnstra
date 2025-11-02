import React from 'react';
import {
    DecayCard,
    DecayStatus,
    DecayProgress,
    DecayDivider,
} from './DecayComponents';
import { DECAY_ICONS } from './theme-utils';
import { JsonViewer } from './JsonViewer';
import { db } from '../model';
import type {
    TNeuronId,
    TStimulation,
    TDendrite,
    UINeuron,
    TStimulationResponse,
} from '../model';
import { useSelectEntitiesByIndexKey, useSelectEntityByPk } from '@oimdb/react';
import { IdUtils } from '@cnstra/devtools-dto';

interface NeuronDetailsPanelProps {
    neuronId: TNeuronId;
    onClose: () => void;
    className?: string;
    appId?: string; // Add appId prop to get current app context
}

export const NeuronDetailsPanel: React.FC<NeuronDetailsPanelProps> = ({
    neuronId,
    onClose,
    className = '',
    appId,
}) => {
    const neuron = useSelectEntityByPk(db.neurons, neuronId) as
        | UINeuron
        | undefined;

    const getActivityLevel = (
        count: number
    ): { level: string; status: 'healthy' | 'infected' | 'critical' } => {
        if (count === 0) return { level: 'Inactive', status: 'healthy' };
        if (count < 5) return { level: 'Low', status: 'healthy' };
        if (count < 15) return { level: 'Medium', status: 'infected' };
        if (count < 30) return { level: 'High', status: 'infected' };
        if (count < 50) return { level: 'Very High', status: 'critical' };
        return { level: 'Critical', status: 'critical' };
    };

    const formatTimestamp = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString();
    };

    const activity = getActivityLevel(neuron?.stimulationCount || 0);

    const currentAppId = appId || 'unknown';

    // Dendrites of this neuron
    const neuronDendritesRaw = useSelectEntitiesByIndexKey(
        db.dendrites,
        db.dendrites.indexes.neuronId,
        neuronId
    );

    const neuronDendrites = (neuronDendritesRaw || []).filter(
        (d): d is NonNullable<typeof d> => d != null
    ) as TDendrite[];

    // Get all responses for this app
    const allResponsesRaw = useSelectEntitiesByIndexKey(
        db.responses,
        db.responses.indexes.appId,
        currentAppId
    );

    const allResponses = (allResponsesRaw || []).filter(
        (r): r is NonNullable<typeof r> => r != null
    );

    // Get all collaterals to find which ones belong to this neuron
    const allCollaterals = db.collaterals.getAll();
    const neuronCollaterals = allCollaterals.filter(
        c => c.neuronId === neuronId
    );
    const neuronCollateralNames = neuronCollaterals.map(c => c.name);

    // Input signals: responses where inputCollateralName matches dendrite names
    const dendriteNames = neuronDendrites.map(d => d.name);
    const inputSignals = allResponses.filter(
        r =>
            r.inputCollateralName &&
            dendriteNames.includes(r.inputCollateralName)
    );

    // Output signals: responses where outputCollateralName matches neuron's collaterals
    const outputSignals = allResponses.filter(
        r =>
            r.outputCollateralName &&
            neuronCollateralNames.includes(r.outputCollateralName)
    );

    // Debug logging for E2E
    try {
        (window as any).__neuronPanelDebug = {
            neuronId,
            appId: currentAppId,
            allResponses: allResponses.length,
            inputSignals: inputSignals.length,
            outputSignals: outputSignals.length,
            dendriteNames,
            neuronCollateralNames,
        };
    } catch {}

    if (!neuron) return null;

    return (
        <div
            className={`neuron-details-panel ${className}`}
            style={{
                position: 'fixed',
                top: 0,
                right: 0,
                width: '600px',
                height: '100vh',
                background: 'var(--bg-panel)',
                border: '2px solid var(--border-infected)',
                borderTop: 'none',
                borderRight: 'none',
                boxShadow:
                    'inset 0 0 20px var(--shadow-blood), -5px 0 15px var(--shadow-dark)',
                zIndex: 1000,
                overflowY: 'auto',
                padding: 'var(--spacing-lg)',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 'var(--spacing-lg)',
                    gap: 'var(--spacing-md)',
                }}
            >
                <div style={{ flex: 1 }}>
                    <h2
                        className="heading-decay md decay-glow"
                        style={{
                            margin: 0,
                            color: 'var(--infection-red)',
                            textShadow: '0 0 5px var(--infection-red)',
                            fontSize: 'var(--font-size-lg)',
                            lineHeight: 1.2,
                        }}
                    >
                        {DECAY_ICONS.brain} {neuron?.name}
                    </h2>
                    <div
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            marginTop: 'var(--spacing-xs)',
                        }}
                    >
                        ID:{' '}
                        <code style={{ color: 'var(--text-accent)' }}>
                            {neuron?.id}
                        </code>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="btn-infected"
                    style={{
                        minWidth: '40px',
                        padding: 'var(--spacing-xs)',
                        fontSize: 'var(--font-size-sm)',
                    }}
                    title="Close panel"
                >
                    ✕
                </button>
            </div>

            {/* Neuron Info */}
            <DecayCard title="Neuron Information">
                <div>
                    <strong>Activity Level:</strong>
                    <DecayStatus
                        status={activity.status}
                        label={activity.level}
                    />
                </div>
            </DecayCard>

            {/* Activity Metrics */}
            <DecayCard
                title="Activity Metrics"
                glowing={(neuron?.stimulationCount || 0) > 30}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 'var(--spacing-sm)',
                    }}
                >
                    <div style={{ textAlign: 'center' }}>
                        <div
                            style={{
                                display: 'flex',
                                gap: 'var(--spacing-md)',
                                justifyContent: 'center',
                            }}
                        >
                            <div style={{ textAlign: 'center' }}>
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-lg)',
                                        color: 'var(--decay-blue)',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    {inputSignals.length}
                                </div>
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    Input Signals
                                </div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-lg)',
                                        color: 'var(--decay-orange)',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    {outputSignals.length}
                                </div>
                                <div
                                    style={{
                                        fontSize: 'var(--font-size-xs)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    Output Signals
                                </div>
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div
                            style={{
                                fontSize: 'var(--font-size-2xl)',
                                color: 'var(--infection-green)',
                                fontWeight: 'bold',
                            }}
                        >
                            {inputSignals.length + outputSignals.length}
                        </div>
                        <div
                            style={{
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--text-muted)',
                            }}
                        >
                            Total Signals
                        </div>
                    </div>
                </div>
            </DecayCard>

            {/* Dendrites & Response History */}
            <DecayCard title="Dendrites & Response History">
                {neuronDendrites.length > 0 ? (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-md)',
                        }}
                    >
                        {neuronDendrites.map(dendrite => {
                            // Get all responses for this dendrite (inputCollateralName matches dendrite name)
                            const dendriteResponses = allResponses.filter(
                                r => r.inputCollateralName === dendrite.name
                            );

                            const recentResponses = dendriteResponses
                                .sort((a, b) => b.timestamp - a.timestamp)
                                .slice(0, 15);

                            return (
                                <div
                                    key={dendrite.id}
                                    style={{
                                        padding: 'var(--spacing-sm)',
                                        background: 'var(--bg-card)',
                                        border: '1px solid var(--border-primary)',
                                        borderRadius: 'var(--radius-sm)',
                                    }}
                                >
                                    <div
                                        style={{
                                            marginBottom: 'var(--spacing-xs)',
                                            color: 'var(--decay-blue)',
                                            fontWeight: 'bold',
                                        }}
                                    >
                                        {DECAY_ICONS.dna} {dendrite.name}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 'var(--font-size-xs)',
                                            color: 'var(--text-muted)',
                                        }}
                                    >
                                        Responses: {dendriteResponses.length}
                                    </div>

                                    {recentResponses.length > 0 && (
                                        <div
                                            style={{
                                                marginTop: 'var(--spacing-xs)',
                                                paddingLeft:
                                                    'var(--spacing-sm)',
                                                borderLeft:
                                                    '2px solid var(--border-primary)',
                                            }}
                                        >
                                            {recentResponses.map(resp => (
                                                <div
                                                    key={resp.responseId}
                                                    style={{
                                                        fontSize:
                                                            'var(--font-size-xs)',
                                                        padding:
                                                            'var(--spacing-xs) 0',
                                                        borderBottom:
                                                            '1px dashed var(--border-primary)',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent:
                                                                'space-between',
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                color: 'var(--text-accent)',
                                                            }}
                                                        >
                                                            {resp.inputCollateralName ||
                                                                '?'}
                                                        </span>
                                                        <span>→</span>
                                                        <span
                                                            style={{
                                                                color: 'var(--decay-orange)',
                                                            }}
                                                        >
                                                            {resp.outputCollateralName ||
                                                                'no output'}
                                                        </span>
                                                    </div>
                                                    <div
                                                        style={{
                                                            color: 'var(--text-muted)',
                                                            fontSize:
                                                                'var(--font-size-2xs)',
                                                        }}
                                                    >
                                                        {formatTimestamp(
                                                            resp.timestamp
                                                        )}
                                                    </div>
                                                    {resp.inputPayload ||
                                                    resp.outputPayload ? (
                                                        <div
                                                            style={{
                                                                marginTop: 4,
                                                                fontSize:
                                                                    'var(--font-size-2xs)',
                                                            }}
                                                        >
                                                            {resp.inputPayload ? (
                                                                <JsonViewer
                                                                    data={
                                                                        resp.inputPayload
                                                                    }
                                                                    title="💉 Input Payload"
                                                                    defaultExpanded={
                                                                        false
                                                                    }
                                                                />
                                                            ) : undefined}
                                                            {resp.outputPayload ? (
                                                                <JsonViewer
                                                                    data={
                                                                        resp.outputPayload
                                                                    }
                                                                    title="⚡ Output Payload"
                                                                    defaultExpanded={
                                                                        false
                                                                    }
                                                                />
                                                            ) : undefined}
                                                        </div>
                                                    ) : undefined}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div
                        style={{
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                        }}
                    >
                        {DECAY_ICONS.skull} No dendrites found
                    </div>
                )}
            </DecayCard>
        </div>
    );
};

export default NeuronDetailsPanel;
