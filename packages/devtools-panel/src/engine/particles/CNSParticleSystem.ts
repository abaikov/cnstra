import * as PIXI from 'pixi.js';
import { ICNSParticleSystem } from './interfaces/ICNSParticleSystem';
import {
    TCNSParticlePreset,
    TCNSMakeDefaultParticlePreset,
} from './TCNSParticlePreset';
import { GraphRenderer } from '../../graph/renderer';

export class CNSParticleSystem implements ICNSParticleSystem {
    private app: PIXI.Application;
    private renderer: GraphRenderer;
    private preset: TCNSParticlePreset;
    private particles: Map<string, PIXI.Graphics> = new Map();
    private edgeHeat: Map<string, number> = new Map();
    private container: PIXI.Container;

    constructor(app: PIXI.Application, renderer: GraphRenderer) {
        this.app = app;
        this.renderer = renderer;
        this.preset = TCNSMakeDefaultParticlePreset();
        this.container = new PIXI.Container();
        this.app.stage.addChild(this.container);
    }

    spawnParticles(edgeId: string, count?: number): void {
        const burstCount = count ?? this.preset.maxPerEdgeBurst;
        const edge = this.renderer.getEdge(edgeId);

        if (!edge) return;

        // Увеличиваем тепло ребра
        const currentHeat = this.edgeHeat.get(edgeId) ?? 0;
        this.edgeHeat.set(edgeId, currentHeat + burstCount);

        // Спавним частицы
        for (let i = 0; i < burstCount; i++) {
            this.spawnParticle(edgeId, edge);
        }
    }

    private spawnParticle(edgeId: string, edge: PIXI.Graphics): void {
        const particle = new PIXI.Graphics();
        const style = this.preset.style;

        // Настройка частицы
        particle.beginFill(Number(style.color.replace('#', '0x')), 1.0);
        particle.drawCircle(0, 0, style.size);
        particle.endFill();

        // Добавляем шлейф
        particle.beginFill(
            Number(style.color.replace('#', '0x')),
            style.trailAlpha
        );
        particle.drawCircle(0, 0, style.size * 1.5);
        particle.endFill();

        // Позиционируем частицу на ребре
        const edgeBounds = edge.getBounds();
        particle.x = edgeBounds.x + Math.random() * edgeBounds.width;
        particle.y = edgeBounds.y + Math.random() * edgeBounds.height;

        // Анимация частицы
        const particleId = `${edgeId}-${Date.now()}-${Math.random()}`;
        this.particles.set(particleId, particle);
        this.container.addChild(particle);

        // Удаляем частицу через время жизни
        setTimeout(() => {
            if (this.particles.has(particleId)) {
                const p = this.particles.get(particleId);
                if (p && p.parent) {
                    p.parent.removeChild(p);
                }
                this.particles.delete(particleId);
            }
        }, style.life);
    }

    update(deltaTime: number): void {
        // Обновляем тепло ребер (охлаждение)
        this.edgeHeat.forEach((heat, edgeId) => {
            const newHeat = heat * 0.98; // охлаждение
            if (newHeat < 0.1) {
                this.edgeHeat.delete(edgeId);
            } else {
                this.edgeHeat.set(edgeId, newHeat);
            }
        });

        // Обновляем позиции частиц
        this.particles.forEach((particle, id) => {
            // Простая анимация движения
            particle.x += (Math.random() - 0.5) * 2;
            particle.y += (Math.random() - 0.5) * 2;
        });
    }

    setPreset(preset: TCNSParticlePreset): void {
        this.preset = preset;
    }

    clear(): void {
        // Очищаем все частицы
        this.particles.forEach(particle => {
            if (particle.parent) {
                particle.parent.removeChild(particle);
            }
        });
        this.particles.clear();
        this.edgeHeat.clear();
    }

    getEdgeHeat(edgeId: string): number {
        return this.edgeHeat.get(edgeId) ?? 0;
    }
}
