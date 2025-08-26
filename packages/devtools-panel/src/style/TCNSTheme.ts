import type { TCNSHex } from './TCNSColor';
import { TCNSHash32 } from './TCNSHash';
import { TCNSHsl, TCNSLighten, TCNSWithAlpha } from './TCNSColor';

export const CANVAS_BG: TCNSHex = '#0a0b10' as const;

// Базовая неоновая палитра (раскиданные по кругу HSL → HEX)
export const NEON_PALETTE: readonly TCNSHex[] = [
    TCNSHsl(200, 100, 60), // ледяной циан
    TCNSHsl(280, 100, 65), // фиолет
    TCNSHsl(160, 100, 50), // мята
    TCNSHsl(330, 100, 60), // розовый
    TCNSHsl(45, 100, 55), // янтарь
    TCNSHsl(12, 100, 55), // коралл
    TCNSHsl(100, 100, 50), // лайм
    TCNSHsl(220, 100, 65), // электрик
] as const;

// Детерминированный цвет группы
export function TCNSGetGroupColor(group?: string): TCNSHex {
    if (!group) return '#66e0ff' as TCNSHex;
    const i = TCNSHash32(group) % NEON_PALETTE.length;
    return NEON_PALETTE[i] as TCNSHex;
}

// Нормализация тепла (0..1)
export function normHeat(heat: number, min = 0, max = 100): number {
    if (!Number.isFinite(heat)) return 0;
    const n = (heat - min) / (max - min);
    return Math.max(0, Math.min(1, n));
}

export type TCNSNodeStyle = {
    radius: number;
    fill: TCNSHex;
    stroke: TCNSHex;
    strokeWidth: number;
    glow: TCNSHex;
};

export type TCNSEdgeStyle = {
    color: TCNSHex;
    width: number;
    alpha: number; // для Graphics.lineStyle/lineTexture
    dash?: { size: number; gap: number; speed: number }; // если понадобятся точки
    glow: TCNSHex;
};

export type TCNSParticleStyle = {
    size: number; // px
    speed: number; // px/s по полилинии
    life: number; // ms
    color: TCNSHex;
    trailAlpha: number; // 0..1
};

export function TCNSNodeStyle(
    opts: { group?: string; active?: boolean } = {}
): TCNSNodeStyle {
    const base = TCNSGetGroupColor(opts.group);
    return {
        radius: 12,
        fill: TCNSWithAlpha(
            TCNSLighten(base, opts.active ? 18 : 6),
            0.15
        ) as TCNSHex,
        stroke: base,
        strokeWidth: opts.active ? 3.0 : 2.0,
        glow: base,
    };
}

export function TCNSEdgeStyle(
    opts: { group?: string; heat?: number; active?: boolean } = {}
): TCNSEdgeStyle {
    const base = TCNSGetGroupColor(opts.group);
    const h = normHeat(opts.heat ?? 0);
    const width = 1.0 + 3.0 * h + (opts.active ? 1.2 : 0); // 1..5.2
    const alpha = 0.35 + 0.5 * h + (opts.active ? 0.15 : 0); // 0.35..1.0
    return {
        color: base,
        width,
        alpha,
        glow: base,
        // dash: { size: 8, gap: 6, speed: 120 }, // если захочешь пунктир-анимацию
    };
}

export function TCNSParticleStyle(
    opts: { group?: string } = {}
): TCNSParticleStyle {
    const base = TCNSGetGroupColor(opts.group);
    return {
        size: 3.2,
        speed: 420, // быстро выглядит «электрически»
        life: 900,
        color: base,
        trailAlpha: 0.35,
    };
}
