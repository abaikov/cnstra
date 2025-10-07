import React, { useState } from 'react';
import {
    DecayButton,
    DecayCard,
    DecayStatus,
    DecayProgress,
    DecayNotification,
    DecayTable,
    DecayInput,
    DecayLoader,
    DecayDivider,
} from './DecayComponents';
import { DECAY_ICONS } from './theme-utils';

export const DecayDemo: React.FC = () => {
    const [inputValue, setInputValue] = useState('');
    const [showNotification, setShowNotification] = useState(true);

    return (
        <div
            style={{
                padding: 'var(--spacing-xl)',
                maxWidth: '800px',
                margin: '0 auto',
            }}
        >
            <h1 className="heading-decay lg decay-glow">
                {DECAY_ICONS.biohazard} Decay Theme Demo {DECAY_ICONS.biohazard}
            </h1>

            <DecayDivider />

            <div
                style={{
                    display: 'grid',
                    gap: 'var(--spacing-lg)',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                }}
            >
                <DecayCard title="System Status" glowing>
                    <DecayStatus status="infected" label="Neural Network" />
                    <DecayStatus status="critical" label="Memory Core" />
                    <DecayStatus status="healthy" label="Power Supply" />

                    <DecayDivider />

                    <DecayProgress
                        value={75}
                        max={100}
                        label="Infection Level"
                    />
                    <DecayProgress value={23} max={100} label="System Health" />
                    <DecayProgress
                        value={90}
                        max={100}
                        label="Corruption Rate"
                    />
                </DecayCard>

                <DecayCard title="Control Panel">
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-md)',
                        }}
                    >
                        <DecayButton variant="primary">
                            {DECAY_ICONS.virus} Initiate Infection
                        </DecayButton>

                        <DecayButton variant="danger">
                            {DECAY_ICONS.skull} Terminate Process
                        </DecayButton>

                        <DecayButton variant="warning">
                            {DECAY_ICONS.warning} Quarantine System
                        </DecayButton>

                        <DecayDivider />

                        <DecayInput
                            value={inputValue}
                            onChange={setInputValue}
                            placeholder="Enter decay command..."
                        />

                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-sm)',
                            }}
                        >
                            <DecayLoader />
                            <span
                                style={{
                                    color: 'var(--text-muted)',
                                    fontSize: 'var(--font-size-xs)',
                                }}
                            >
                                Processing corruption...
                            </span>
                        </div>
                    </div>
                </DecayCard>
            </div>

            <DecayDivider />

            <DecayCard title="Infection Log">
                <DecayTable
                    headers={['Time', 'Process', 'Status', 'Severity']}
                    rows={[
                        [
                            '12:34:56',
                            'neural_core.exe',
                            <DecayStatus
                                key={1}
                                status="infected"
                                label="INFECTED"
                            />,
                            'High',
                        ],
                        [
                            '12:33:21',
                            'memory_scan.dll',
                            <DecayStatus
                                key={2}
                                status="critical"
                                label="CRITICAL"
                            />,
                            'Fatal',
                        ],
                        [
                            '12:32:45',
                            'system_check.bat',
                            <DecayStatus
                                key={3}
                                status="healthy"
                                label="CLEAN"
                            />,
                            'Low',
                        ],
                        [
                            '12:31:12',
                            'data_recovery.py',
                            <DecayStatus
                                key={4}
                                status="infected"
                                label="CORRUPTED"
                            />,
                            'Medium',
                        ],
                    ]}
                />
            </DecayCard>

            {showNotification && (
                <DecayNotification
                    type="error"
                    message="Critical system infection detected! Immediate quarantine required."
                    onClose={() => setShowNotification(false)}
                />
            )}

            <DecayDivider />

            <div
                style={{
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--font-size-xs)',
                }}
            >
                <p className="glitch-text">
                    {DECAY_ICONS.crossBones} System compromised - decay theme
                    active {DECAY_ICONS.crossBones}
                </p>
            </div>
        </div>
    );
};
