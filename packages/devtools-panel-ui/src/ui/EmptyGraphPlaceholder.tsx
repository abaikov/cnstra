import React from 'react';
import { DECAY_ICONS } from './theme-utils';

interface EmptyGraphPlaceholderProps {
    message?: string;
    submessage?: string;
    className?: string;
}

export const EmptyGraphPlaceholder: React.FC<EmptyGraphPlaceholderProps> = ({
    message = 'No CNS Data Available',
    submessage = 'Connect an app with CNS to see the neural network topology',
    className = '',
}) => {
    return (
        <div
            className={`empty-graph-placeholder ${className}`}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                width: '100%',
                minHeight: '400px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                textAlign: 'center',
                padding: 'var(--spacing-xl)',
            }}
        >
            {/* Pulsing heart icon */}
            <div
                className="pulse-infection decay-glow"
                style={{
                    fontSize: '120px',
                    marginBottom: 'var(--spacing-xl)',
                    filter: 'drop-shadow(0 0 20px var(--infection-red))',
                }}
            >
                💀
            </div>

            {/* Main message */}
            <h2
                className="heading-decay lg"
                style={{
                    margin: `0 0 var(--spacing-md) 0`,
                    color: 'var(--infection-red)',
                    textShadow: '0 0 10px var(--infection-red)',
                    fontSize: 'var(--font-size-2xl)',
                }}
            >
                {message}
            </h2>

            {/* Submessage */}
            <p
                style={{
                    margin: `0 0 var(--spacing-xl) 0`,
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--font-size-base)',
                    maxWidth: '500px',
                    lineHeight: 1.5,
                }}
            >
                {submessage}
            </p>

            {/* Animated elements */}
            <div
                style={{
                    display: 'flex',
                    gap: 'var(--spacing-lg)',
                    alignItems: 'center',
                    marginTop: 'var(--spacing-xl)',
                }}
            >
                <div
                    className="flicker"
                    style={{
                        fontSize: 'var(--font-size-3xl)',
                        color: 'var(--infection-green)',
                        textShadow: '0 0 8px var(--infection-green)',
                    }}
                >
                    {DECAY_ICONS.virus}
                </div>

                <div
                    style={{
                        width: '60px',
                        height: '2px',
                        background:
                            'linear-gradient(90deg, var(--infection-green), var(--infection-red))',
                        animation: 'pulse-infection 2s infinite',
                    }}
                />

                <div
                    className="flicker"
                    style={{
                        fontSize: 'var(--font-size-3xl)',
                        color: 'var(--infection-purple)',
                        textShadow: '0 0 8px var(--infection-purple)',
                        animationDelay: '0.5s',
                    }}
                >
                    {DECAY_ICONS.brain}
                </div>

                <div
                    style={{
                        width: '60px',
                        height: '2px',
                        background:
                            'linear-gradient(90deg, var(--infection-purple), var(--infection-yellow))',
                        animation: 'pulse-infection 2s infinite',
                        animationDelay: '1s',
                    }}
                />

                <div
                    className="flicker"
                    style={{
                        fontSize: 'var(--font-size-3xl)',
                        color: 'var(--infection-yellow)',
                        textShadow: '0 0 8px var(--infection-yellow)',
                        animationDelay: '1.5s',
                    }}
                >
                    {DECAY_ICONS.dna}
                </div>
            </div>

            {/* Instructions */}
            <div
                style={{
                    marginTop: 'var(--spacing-2xl)',
                    padding: 'var(--spacing-lg)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-infected)',
                    borderRadius: 'var(--radius-md)',
                    maxWidth: '600px',
                }}
            >
                <h3
                    style={{
                        margin: `0 0 var(--spacing-md) 0`,
                        color: 'var(--text-accent)',
                        fontSize: 'var(--font-size-lg)',
                    }}
                >
                    {DECAY_ICONS.biohazard} How to Connect
                </h3>

                <div
                    style={{
                        textAlign: 'left',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.6,
                    }}
                >
                    <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                        <strong style={{ color: 'var(--text-accent)' }}>
                            1.
                        </strong>{' '}
                        Start your CNS application
                    </div>
                    <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                        <strong style={{ color: 'var(--text-accent)' }}>
                            2.
                        </strong>{' '}
                        Initialize CNSDevTools in your app
                    </div>
                    <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                        <strong style={{ color: 'var(--text-accent)' }}>
                            3.
                        </strong>{' '}
                        Perform some stimulations
                    </div>
                    <div>
                        <strong style={{ color: 'var(--text-accent)' }}>
                            4.
                        </strong>{' '}
                        Watch the neural network come alive!
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmptyGraphPlaceholder;
