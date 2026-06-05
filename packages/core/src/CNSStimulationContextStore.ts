import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';

export class CNSStimulationContextStore implements ICNSStimulationContextStore {
    // Lazily allocated: most stimulations never touch neuron context, so we
    // avoid allocating the backing Map until something is actually stored.
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
