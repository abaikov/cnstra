import type { TCNSTimePreset } from '../types/TCNSTimePreset';

export const TIME_PRESETS: readonly TCNSTimePreset[] = [
    { label: '5m', durationMs: 5 * 60_000 },
    { label: '15m', durationMs: 15 * 60_000 },
    { label: '1h', durationMs: 60 * 60_000 },
    { label: '24h', durationMs: 24 * 60 * 60_000 },
    { label: 'All', durationMs: 0 },
];
