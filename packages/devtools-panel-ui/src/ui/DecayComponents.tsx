import React from 'react';
import { DECAY_ICONS } from './theme-utils';

interface DecayButtonProps {
    onClick?: () => void;
    children: React.ReactNode;
    variant?: 'primary' | 'danger' | 'warning';
    className?: string;
}

export const DecayButton: React.FC<DecayButtonProps> = ({
    onClick,
    children,
    variant = 'primary',
    className = '',
}) => {
    const variantClass = {
        primary: 'btn-infected',
        danger: 'btn-infected text-infected',
        warning: 'btn-infected text-pus-yellow',
    }[variant];

    return (
        <button className={`${variantClass} ${className}`} onClick={onClick}>
            {children}
        </button>
    );
};

interface DecayCardProps {
    children: React.ReactNode;
    title?: string;
    className?: string;
    glowing?: boolean;
}

export const DecayCard: React.FC<DecayCardProps> = ({
    children,
    title,
    className = '',
    glowing = false,
}) => {
    return (
        <div
            className={`card-decay ${
                glowing ? 'pulse-infection' : ''
            } ${className}`}
        >
            {title && (
                <h3 className="heading-decay md">
                    {DECAY_ICONS.skull} {title}
                </h3>
            )}
            {children}
        </div>
    );
};

interface DecayStatusProps {
    status: 'healthy' | 'infected' | 'critical';
    label: string;
    className?: string;
}

export const DecayStatus: React.FC<DecayStatusProps> = ({
    status,
    label,
    className = '',
}) => {
    const statusClass = {
        healthy: 'status-healthy',
        infected: 'status-infected flicker',
        critical: 'status-critical',
    }[status];

    const icon = {
        healthy: DECAY_ICONS.heart,
        infected: DECAY_ICONS.virus,
        critical: DECAY_ICONS.skull,
    }[status];

    return (
        <div className={`${statusClass} ${className}`}>
            {icon} {label}
        </div>
    );
};

interface DecayProgressProps {
    value: number;
    max: number;
    label?: string;
    className?: string;
}

export const DecayProgress: React.FC<DecayProgressProps> = ({
    value,
    max,
    label,
    className = '',
}) => {
    const percentage = Math.min((value / max) * 100, 100);

    return (
        <div className={`${className}`}>
            {label && (
                <div
                    style={{
                        marginBottom: 'var(--spacing-xs)',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--text-secondary)',
                    }}
                >
                    {DECAY_ICONS.dna} {label}: {value}/{max}
                </div>
            )}
            <div className="progress-infection">
                <div
                    className="progress-infection-fill"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
};

interface DecayNotificationProps {
    type: 'error' | 'warning' | 'success';
    message: string;
    onClose?: () => void;
    className?: string;
}

export const DecayNotification: React.FC<DecayNotificationProps> = ({
    type,
    message,
    onClose,
    className = '',
}) => {
    const icon = {
        error: DECAY_ICONS.skull,
        warning: DECAY_ICONS.warning,
        success: DECAY_ICONS.virus,
    }[type];

    return (
        <div className={`notification-decay ${type} ${className}`}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-sm)',
                }}
            >
                <span>{icon}</span>
                <span>{message}</span>
                {onClose && (
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            marginLeft: 'auto',
                        }}
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
};

interface DecayTableProps {
    headers: string[];
    rows: (string | React.ReactNode)[][];
    className?: string;
}

export const DecayTable: React.FC<DecayTableProps> = ({
    headers,
    rows,
    className = '',
}) => {
    return (
        <table className={`table-decay ${className}`}>
            <thead>
                <tr>
                    {headers.map((header, index) => (
                        <th key={index}>
                            {DECAY_ICONS.bone} {header}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>{cell}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

interface DecayInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: 'text' | 'password' | 'number';
    className?: string;
}

export const DecayInput: React.FC<DecayInputProps> = ({
    value,
    onChange,
    placeholder,
    type = 'text',
    className = '',
}) => {
    return (
        <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className={`input-infected ${className}`}
        />
    );
};

export const DecayLoader: React.FC<{ className?: string }> = ({
    className = '',
}) => {
    return <div className={`loader-decay ${className}`} />;
};

export const DecayDivider: React.FC<{ className?: string }> = ({
    className = '',
}) => {
    return <hr className={`divider-decay ${className}`} />;
};
