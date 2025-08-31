import { TCNSStimulationQueueItem } from './types/TCNSStimulationQueueItem';

export class CNSFunctionalQueue<TCollateralId extends string> {
    public readonly items: TCNSStimulationQueueItem<TCollateralId>[] = [];
    protected activeOperations = 0;

    // NEW: prevent re-entrant pump; defer extra runs
    private pumping = false;
    private needsPump = false;

    constructor(
        protected readonly concurrency?: number,
        protected readonly abortSignal?: AbortSignal
    ) {}

    protected get canStartOperation(): boolean {
        const limit = this.concurrency ?? Infinity;
        return this.activeOperations < limit && !this.abortSignal?.aborted;
    }

    protected pump() {
        if (this.pumping) {
            this.needsPump = true;
            return;
        }
        this.pumping = true;

        while (this.canStartOperation && this.items.length > 0) {
            const item = this.items.shift()!;
            this.activeOperations++;

            const ret = item.callback();

            // Async branch
            if (ret && typeof (ret as any).then === 'function') {
                (ret as Promise<void | (() => void)>).then(
                    cb => {
                        // finish this item
                        this.activeOperations--;
                        if (typeof cb === 'function') cb();

                        // schedule another pass (but don't re-enter if already pumping)
                        if (this.items.length > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                    },
                    err => {
                        this.activeOperations--;
                        // resume if there’s more work
                        if (this.items.length > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                        throw err; // let it crash "honestly"
                    }
                );
                // Stop the loop; continuation will happen from the promise handler
                break;
            }

            // Sync branch
            this.activeOperations--;
            if (typeof ret === 'function') (ret as () => void)();
            // Loop continues; any items added by ret() stay in the same flat loop
        }

        this.pumping = false;

        // If async completions or enqueues requested another pass, do exactly one more, non-recursively
        if (this.needsPump) {
            this.needsPump = false;
            this.pump();
        }
    }

    enqueue(x: TCNSStimulationQueueItem<TCollateralId>) {
        this.items.push(x);
        // Start pumping only if not already pumping; avoid re-entrant pump
        if (!this.pumping) this.pump();
        else this.needsPump = true;
    }

    get length() {
        return this.items.length;
    }

    getActiveOperationsCount() {
        return this.activeOperations;
    }
}
