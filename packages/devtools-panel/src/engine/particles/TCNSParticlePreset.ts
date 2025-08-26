import type { TCNSParticleStyle } from '../../style/TCNSTheme';
import { TCNSParticleStyle as createTCNSParticleStyle } from '../../style/TCNSTheme';

export type TCNSParticlePreset = {
    poolSize: number; // сколько спрайтов заранее
    maxPerEdgeBurst: number; // сколько частиц на один enqueue
    style: TCNSParticleStyle;
};

export function TCNSMakeDefaultParticlePreset(
    group?: string
): TCNSParticlePreset {
    return {
        poolSize: 1024,
        maxPerEdgeBurst: 6,
        style: createTCNSParticleStyle({ group }),
    };
}
