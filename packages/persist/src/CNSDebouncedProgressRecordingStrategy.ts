import type { TCNSStimulationResponse } from '@cnstra/types';
import type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
import type { TCNSDebouncedProgressRecordingStrategyOptions } from './types/TCNSDebouncedProgressRecordingStrategyOptions';

/**
 * The default progress strategy: coalesce writes while responses keep arriving
 * (debounce), but flush at least every `maxStalenessMs`, and flush immediately when a
 * response carries an error. Keeps writes cheap during bursts while bounding how
 * stale the persisted frontier can get.
 */
export class CNSDebouncedProgressRecordingStrategy implements ICNSProgressRecordingStrategy {
    private readonly debounceMs: number;
    private readonly maxStalenessMs: number;
    private timer?: ReturnType<typeof setTimeout>;
    private pendingSince?: number;

    constructor(options: TCNSDebouncedProgressRecordingStrategyOptions = {}) {
        this.debounceMs = options.debounceMs ?? 250;
        this.maxStalenessMs = options.maxStalenessMs ?? 2000;
    }

    onResponse(response: TCNSStimulationResponse, flush: () => void): void {
        if (response.error) {
            this.doFlush(flush);
            return;
        }
        const now = Date.now();
        if (this.pendingSince === undefined) this.pendingSince = now;
        if (now - this.pendingSince >= this.maxStalenessMs) {
            this.doFlush(flush);
            return;
        }
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.doFlush(flush), this.debounceMs);
    }

    private doFlush(flush: () => void): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.pendingSince = undefined;
        flush();
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
