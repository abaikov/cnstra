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
    private lastResponseAt = 0;

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
        // One timer per quiet window, not one per response. Re-arming on every
        // response allocated and cancelled a Node timer per hop to perform a
        // single write; instead the armed timer asks on arrival how long the run
        // has actually been quiet, and re-arms for the remainder if it is early.
        // Same debounce semantics — the flush still lands `debounceMs` after the
        // LAST response, not after the first.
        this.lastResponseAt = now;
        if (this.timer === undefined) this.arm(flush, this.debounceMs);
    }

    private arm(flush: () => void, delayMs: number): void {
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const idleMs = Date.now() - this.lastResponseAt;
            if (idleMs >= this.debounceMs) this.doFlush(flush);
            else this.arm(flush, this.debounceMs - idleMs);
        }, delayMs);
    }

    private doFlush(flush: () => void): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.pendingSince = undefined;
        flush();
    }

    /**
     * Cancel the pending flush. Idempotent, and safe to call mid-run: the
     * persistor uses it to drop a stale cadence timer before its terminal write,
     * so the staleness window is cleared here too — after this there is nothing
     * pending, and the next response starts a fresh one rather than being
     * treated as already overdue.
     */
    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.pendingSince = undefined;
    }
}
