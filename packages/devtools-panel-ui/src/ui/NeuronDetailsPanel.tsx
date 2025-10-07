import React from 'react';
import {
    DecayCard,
    DecayStatus,
    DecayProgress,
    DecayDivider,
} from './DecayComponents';
import { DECAY_ICONS } from './theme-utils';
import { db } from '../model';
import type { TNeuronId, TStimulation, TDendrite, UINeuron } from '../model';
import { useSelectEntitiesByIndexKey, useSelectEntityByPk } from '@oimdb/react';

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

    // Get output stimulations from database (stimulations initiated by this neuron)
    const currentAppId = appId || 'unknown';
    const allStimulations =
        (useSelectEntitiesByIndexKey(
            db.stimulations,
            db.stimulations.indexes.appId,
            currentAppId
        ) as TStimulation[]) || [];

    // Dendrites of this neuron
    const neuronDendrites =
        (useSelectEntitiesByIndexKey(
            db.dendrites,
            db.dendrites.indexes.neuronId,
            neuronId
        ) as TDendrite[]) || [];

    // Input signals: stimulations targeting collaterals this neuron listens to
    const listenedCollaterals = neuronDendrites.map(d => d.collateralName);
    const normalize = (c?: string) => (c || '').replace(/^.*:collateral:/, '');
    const inputSignals = allStimulations.filter(s =>
        listenedCollaterals.some(
            col => normalize(col) === normalize(s.collateralName)
        )
    );

    // Output signals: stimulations where this neuron was the source
    const outputSignals = allStimulations.filter(
        stim => stim.neuronId === neuron?.id || stim.neuronId === neuron?.name
    );

    const recentInputSignals = inputSignals
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
    const recentOutputSignals = outputSignals
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);

    // Aggregate recent stimulations (input + output)
    const recentStimulations = [...inputSignals, ...outputSignals]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

    if (!neuron) return null;

    return (
        <div
            className={`neuron-details-panel ${className}`}
            style={{
                position: 'fixed',
                top: 0,
                right: 0,
                width: '400px',
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

            {/* Recent Input & Output Signals */}
            <DecayCard title="Recent Input Signals">
                {recentInputSignals.length > 0 ? (
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {recentInputSignals.map(stimulation => (
                            <div
                                key={stimulation.stimulationId}
                                style={{
                                    padding: 'var(--spacing-sm)',
                                    marginBottom: 'var(--spacing-xs)',
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: 'var(--font-size-xs)',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                    }}
                                >
                                    <span
                                        style={{ color: 'var(--text-accent)' }}
                                    >
                                        {DECAY_ICONS.lightning} Stimulation ID:{' '}
                                        {stimulation.stimulationId}
                                    </span>
                                    <span
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        {formatTimestamp(stimulation.timestamp)}
                                    </span>
                                </div>

                                <div style={{ marginTop: 'var(--spacing-xs)' }}>
                                    <div>
                                        <strong>Collateral:</strong>{' '}
                                        {stimulation.collateralName ||
                                            'unknown'}
                                    </div>
                                    <div>
                                        <strong>Source Neuron:</strong>{' '}
                                        <code>{stimulation.neuronId}</code>
                                    </div>
                                    {'payload' in stimulation &&
                                    (stimulation as any).payload ? (
                                        <div>
                                            <strong>Payload:</strong>{' '}
                                            {JSON.stringify(
                                                (stimulation as any).payload
                                            ).substring(0, 50)}
                                            ...
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div
                        style={{
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                            padding: 'var(--spacing-lg)',
                        }}
                    >
                        {DECAY_ICONS.skull} No input signals recorded
                    </div>
                )}
            </DecayCard>

            {/* Recent Output Signals */}
            <DecayCard title="Recent Output Signals">
                {recentOutputSignals.length > 0 ? (
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {recentOutputSignals.map((stimulation, index) => (
                            <div
                                key={stimulation.stimulationId}
                                style={{
                                    padding: 'var(--spacing-sm)',
                                    marginBottom: 'var(--spacing-xs)',
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: 'var(--font-size-xs)',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                    }}
                                >
                                    <span
                                        style={{ color: 'var(--text-accent)' }}
                                    >
                                        {DECAY_ICONS.lightning} Stimulation ID:{' '}
                                        {stimulation.stimulationId}
                                    </span>
                                    <span
                                        style={{ color: 'var(--text-muted)' }}
                                    >
                                        {formatTimestamp(stimulation.timestamp)}
                                    </span>
                                </div>

                                <div style={{ marginTop: 'var(--spacing-xs)' }}>
                                    <div>
                                        <strong>Collateral:</strong>{' '}
                                        {stimulation.collateralName ||
                                            'unknown'}
                                    </div>
                                    <div>
                                        <strong>Source Neuron:</strong>{' '}
                                        <code>{stimulation.neuronId}</code>
                                    </div>
                                    {stimulation.payload ? (
                                        <div>
                                            <strong>Payload:</strong>{' '}
                                            <span>
                                                {JSON.stringify(
                                                    stimulation.payload as any
                                                ).substring(0, 50)}
                                                ...
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div
                        style={{
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                            padding: 'var(--spacing-lg)',
                        }}
                    >
                        {DECAY_ICONS.skull} No output signals recorded
                    </div>
                )}
            </DecayCard>

            {/* Input & Output Signal Analysis */}
            <DecayCard title="Input & Output Signal Analysis">
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--spacing-sm)',
                    }}
                >
                    <div>
                        <strong>Output Signals Count:</strong>
                        <span style={{ color: 'var(--decay-orange)' }}>
                            {outputSignals.length}
                        </span>
                    </div>

                    <div>
                        <strong>Input Signal Types:</strong>
                        <div style={{ marginTop: 'var(--spacing-xs)' }}>
                            {inputSignals.length > 0 ? (
                                Object.entries(
                                    inputSignals.reduce((acc, s) => {
                                        const type =
                                            s.collateralName || 'unknown';
                                        acc[type] = (acc[type] || 0) + 1;
                                        return acc;
                                    }, {} as Record<string, number>)
                                ).map(([type, count]) => (
                                    <div
                                        key={type}
                                        style={{
                                            fontSize: 'var(--font-size-xs)',
                                        }}
                                    >
                                        {DECAY_ICONS.microbe} {type}: {count}
                                    </div>
                                ))
                            ) : (
                                <span
                                    style={{
                                        color: 'var(--text-muted)',
                                        fontSize: 'var(--font-size-xs)',
                                    }}
                                >
                                    No data available
                                </span>
                            )}
                        </div>
                    </div>

                    <div>
                        <strong>Output Signal Types:</strong>
                        <div style={{ marginTop: 'var(--spacing-xs)' }}>
                            {outputSignals.length > 0 ? (
                                Object.entries(
                                    outputSignals.reduce((acc, s) => {
                                        const type =
                                            s.collateralName || 'unknown';
                                        acc[type] = (acc[type] || 0) + 1;
                                        return acc;
                                    }, {} as Record<string, number>)
                                ).map(([type, count]) => (
                                    <div
                                        key={type}
                                        style={{
                                            fontSize: 'var(--font-size-xs)',
                                        }}
                                    >
                                        {DECAY_ICONS.microbe} {type}: {count}
                                    </div>
                                ))
                            ) : (
                                <span
                                    style={{
                                        color: 'var(--text-muted)',
                                        fontSize: 'var(--font-size-xs)',
                                    }}
                                >
                                    No data available
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </DecayCard>
        </div>
    );
};

export default NeuronDetailsPanel;
