import React from 'react';
import { ICNSControls } from './interfaces/ICNSControls';

interface ControlsProps extends ICNSControls {
    isPlaying: boolean;
    speed: number;
    onPlayPause: () => void;
    onSpeedChange: (speed: number) => void;
}

export const Controls: React.FC<ControlsProps> = ({
    isPlaying,
    speed,
    onPlayPause,
    onSpeedChange,
}) => {
    return (
        <div
            style={{
                position: 'absolute',
                top: 10,
                right: 10,
                background: 'rgba(0, 0, 0, 0.8)',
                padding: '10px',
                borderRadius: '8px',
                color: 'white',
                fontFamily: 'monospace',
                fontSize: '14px',
            }}
        >
            <div style={{ marginBottom: '10px' }}>
                <button
                    onClick={onPlayPause}
                    style={{
                        background: isPlaying ? '#ff4757' : '#2ed573',
                        border: 'none',
                        color: 'white',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                    }}
                >
                    {isPlaying ? '⏸️ Pause' : '▶️ Play'}
                </button>
            </div>

            <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>
                    Speed: {speed}x
                </label>
                <input
                    type="range"
                    min="0.25"
                    max="4"
                    step="0.25"
                    value={speed}
                    onChange={e => onSpeedChange(parseFloat(e.target.value))}
                    style={{ width: '100px' }}
                />
            </div>

            <div style={{ fontSize: '12px', opacity: 0.7 }}>
                <div>Controls:</div>
                <div>• Mouse wheel: Zoom</div>
                <div>• Drag: Pan</div>
                <div>• Click node: Select</div>
            </div>
        </div>
    );
};
