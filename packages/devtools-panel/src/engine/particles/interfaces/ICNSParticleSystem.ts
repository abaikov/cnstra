import type { TCNSParticlePreset as ParticlePreset } from '../TCNSParticlePreset';

export interface ICNSParticleSystem {
    spawnParticles(edgeId: string, count?: number): void;
    update(deltaTime: number): void;
    setPreset(preset: ParticlePreset): void;
    clear(): void;
}
