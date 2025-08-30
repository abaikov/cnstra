import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';

export class CNSStimulationContextStore implements ICNSStimulationContextStore {
    constructor(private readonly ctx: Map<string, unknown> = new Map()) {}

    get(key: string): unknown {
        return this.ctx.get(key);
    }

    set(key: string, value: unknown): void {
        this.ctx.set(key, value);
    }

    getAll(): Record<string, unknown> {
        return Object.fromEntries(this.ctx);
    }

    setAll(values: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(values)) {
            this.ctx.set(key, value);
        }
    }
}
