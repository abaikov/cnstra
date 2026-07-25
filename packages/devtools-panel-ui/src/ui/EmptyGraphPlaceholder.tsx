import type { TExoSchema } from '@exodra/core';
import { DECAY_ICONS } from './theme-utils';

// Native Exodra port — pure presentational placeholder shown when the graph has
// no data. No state, no reactivity: everything is a static schema.

export interface EmptyGraphPlaceholderParams {
    message?: string;
    submessage?: string;
    className?: string;
}

export function emptyGraphPlaceholder({
    message = 'No CNS Data Available',
    submessage = 'Connect an app with CNS to see the neural network topology',
    className = '',
}: EmptyGraphPlaceholderParams = {}): TExoSchema {
    const icon = (
        color: string,
        glyph: string,
        delay?: string
    ): TExoSchema => (
        <div
            static={{
                class: 'flicker',
                style:
                    `font-size:var(--font-size-3xl);color:${color};` +
                    `text-shadow:0 0 8px ${color}` +
                    (delay ? `;animation-delay:${delay}` : ''),
            }}
        >
            {glyph}
        </div>
    );

    const connector = (from: string, to: string, delay?: string): TExoSchema => (
        <div
            static={{
                style:
                    `width:60px;height:2px;background:linear-gradient(90deg, ${from}, ${to});` +
                    'animation:pulse-infection 2s infinite' +
                    (delay ? `;animation-delay:${delay}` : ''),
            }}
        />
    );

    // NB: don't name a local `text` — the Exodra JSX plugin auto-emits `text(...)`
    // calls for text children, and a local `text` would shadow that import.
    const step = (n: string, label: string, last = false): TExoSchema => (
        <div static={{ style: last ? '' : 'margin-bottom:var(--spacing-sm)' }}>
            <strong static={{ style: 'color:var(--text-accent)' }}>{n}.</strong> {label}
        </div>
    );

    return (
        <div
            static={{
                class: `empty-graph-placeholder ${className}`,
                style:
                    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
                    'height:100%;width:100%;min-height:400px;background:var(--bg-primary);' +
                    'color:var(--text-primary);text-align:center;padding:var(--spacing-xl)',
            }}
        >
            <div
                static={{
                    class: 'pulse-infection decay-glow',
                    style: 'font-size:120px;margin-bottom:var(--spacing-xl);filter:drop-shadow(0 0 20px var(--infection-red))',
                }}
            >
                💀
            </div>

            <h2
                static={{
                    class: 'heading-decay lg',
                    style: 'margin:0 0 var(--spacing-md) 0;color:var(--infection-red);text-shadow:0 0 10px var(--infection-red);font-size:var(--font-size-2xl)',
                }}
            >
                {message}
            </h2>

            <p
                static={{
                    style: 'margin:0 0 var(--spacing-xl) 0;color:var(--text-secondary);font-size:var(--font-size-base);max-width:500px;line-height:1.5',
                }}
            >
                {submessage}
            </p>

            <div
                static={{
                    style: 'display:flex;gap:var(--spacing-lg);align-items:center;margin-top:var(--spacing-xl)',
                }}
            >
                {icon('var(--infection-green)', DECAY_ICONS.virus)}
                {connector('var(--infection-green)', 'var(--infection-red)')}
                {icon('var(--infection-purple)', DECAY_ICONS.brain, '0.5s')}
                {connector('var(--infection-purple)', 'var(--infection-yellow)', '1s')}
                {icon('var(--infection-yellow)', DECAY_ICONS.dna, '1.5s')}
            </div>

            <div
                static={{
                    style:
                        'margin-top:var(--spacing-2xl);padding:var(--spacing-lg);background:var(--bg-card);' +
                        'border:1px solid var(--border-infected);border-radius:var(--radius-md);max-width:600px',
                }}
            >
                <h3
                    static={{
                        style: 'margin:0 0 var(--spacing-md) 0;color:var(--text-accent);font-size:var(--font-size-lg)',
                    }}
                >
                    {DECAY_ICONS.biohazard} How to Connect
                </h3>
                <div
                    static={{
                        style: 'text-align:left;font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.6',
                    }}
                >
                    {step('1', 'Start your CNS application')}
                    {step('2', 'Initialize CNSDevTools in your app')}
                    {step('3', 'Perform some stimulations')}
                    {step('4', 'Watch the neural network come alive!', true)}
                </div>
            </div>
        </div>
    );
}

export default emptyGraphPlaceholder;
