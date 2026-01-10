import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';

export class CNSStimulationContextStore implements ICNSStimulationContextStore {
    constructor(private readonly ctx: Map<object, unknown> = new Map()) {}

    get(key: object): unknown {
        return this.ctx.get(key);
    }

    set(key: object, value: unknown): void {
        this.ctx.set(key, value);
    }

    getAll(): Map<object, unknown> {
        return new Map(this.ctx);
    }

    setAll(values: Map<object, unknown>): void {
        this.ctx.clear();
        for (const [key, value] of values) this.ctx.set(key, value);
    }

    delete(key: object): void {
        this.ctx.delete(key);
    }
}
