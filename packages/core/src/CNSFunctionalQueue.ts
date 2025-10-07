import { TCNSStimulationQueueItem } from './types/TCNSStimulationQueueItem';
import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';

export class CNSFunctionalQueue<
    TCollateralName extends string,
    TNeuronName extends string,
    TNeuron extends TCNSNeuron<
        any,
        TNeuronName,
        TCollateralName,
        any,
        any,
        any,
        any
    >,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> {
    private items: TCNSStimulationQueueItem<
        TCollateralName,
        TNeuronName,
        TNeuron,
        TDendrite
    >[] = [];
    private head = 0;
    private tail = 0;
    private size = 0;
    private capacity = 16;
    protected activeOperations = 0;

    // NEW: prevent re-entrant pump; defer extra runs
    private pumping = false;
    private needsPump = false;

    constructor(
        private readonly processor: (
            item: TCNSStimulationQueueItem<
                TCollateralName,
                TNeuronName,
                TNeuron,
                TDendrite
            >
        ) => (() => void) | Promise<() => void>,
        protected readonly concurrency?: number,
        protected readonly abortSignal?: AbortSignal,
        initialCapacity?: number
    ) {
        if (initialCapacity && initialCapacity > 0) {
            this.capacity = initialCapacity;
        }
        this.items = new Array(this.capacity);
    }

    protected get canStartOperation(): boolean {
        const limit = this.concurrency ?? Infinity;
        return this.activeOperations < limit && !this.abortSignal?.aborted;
    }

    private resize(): void {
        const oldCapacity = this.capacity;
        this.capacity = oldCapacity * 2;
        const newItems = new Array(this.capacity);

        let oldIndex = this.head;
        for (let i = 0; i < this.size; i++) {
            newItems[i] = this.items[oldIndex];
            oldIndex = (oldIndex + 1) % oldCapacity;
        }

        this.items = newItems;
        this.head = 0;
        this.tail = this.size;
    }

    private dequeue():
        | TCNSStimulationQueueItem<
              TCollateralName,
              TNeuronName,
              TNeuron,
              TDendrite
          >
        | undefined {
        if (this.size === 0) return undefined;

        const item = this.items[this.head];
        this.items[this.head] = undefined as any; // Clear reference
        this.head = (this.head + 1) % this.capacity;
        this.size--;

        return item;
    }

    private enqueueItem(
        item: TCNSStimulationQueueItem<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite
        >
    ): void {
        if (this.size === this.capacity) {
            this.resize();
        }

        this.items[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        this.size++;
    }

    protected pump() {
        if (this.pumping) {
            this.needsPump = true;
            return;
        }
        this.pumping = true;

        while (this.canStartOperation && this.size > 0) {
            const item = this.dequeue()!;
            this.activeOperations++;

            const ret = this.processor(item);

            // Async branch
            if (ret && typeof (ret as any).then === 'function') {
                (ret as Promise<void | (() => void)>).then(
                    cb => {
                        // finish this item
                        this.activeOperations--;
                        if (typeof cb === 'function') cb();

                        // schedule another pass (but don't re-enter if already pumping)
                        if (this.size > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                    },
                    err => {
                        this.activeOperations--;
                        // resume if there's more work
                        if (this.size > 0 && this.canStartOperation) {
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

    enqueue(
        x: TCNSStimulationQueueItem<
            TCollateralName,
            TNeuronName,
            TNeuron,
            TDendrite
        >
    ) {
        this.enqueueItem(x);
        // Start pumping only if not already pumping; avoid re-entrant pump
        if (!this.pumping) this.pump();
        else this.needsPump = true;
    }

    get length() {
        return this.size;
    }

    getActiveOperationsCount() {
        return this.activeOperations;
    }
}
