import type { ICNSStimulationContextStore } from '@cnstra/types';

/**
 * Persist's own context store implementation (mirrors the one in @cnstra/core) so
 * `CNSCheckpointSerializer.hydrate()` can build a ready-to-use `ctx` for
 * `cns.activate({ ctx })` without depending on @cnstra/core at runtime.
 */
export class CNSStimulationContextStore implements ICNSStimulationContextStore {
    private ctx?: Map<object, unknown>;

    constructor(ctx?: Map<object, unknown>) {
        this.ctx = ctx;
    }

    get(key: object): unknown {
        return this.ctx?.get(key);
    }

    set(key: object, value: unknown): void {
        (this.ctx ??= new Map()).set(key, value);
    }

    getAll(): Map<object, unknown> {
        return this.ctx ? new Map(this.ctx) : new Map();
    }

    setAll(values: Map<object, unknown>): void {
        const ctx = (this.ctx ??= new Map());
        ctx.clear();
        for (const [key, value] of values) ctx.set(key, value);
    }

    delete(key: object): void {
        this.ctx?.delete(key);
    }
}
