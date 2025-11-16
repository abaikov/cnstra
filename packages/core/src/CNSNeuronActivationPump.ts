import { TCNSNeuronActivationTask } from './types/TCNSNeuronActivationTask';

export class CNSNeuronActivationPump<
    TCollateralName extends string,
    TNeuronName extends string
> {
    private items: TCNSNeuronActivationTask<TCollateralName, TNeuronName>[] =
        [];
    private head = 0;
    private tail = 0;
    private size = 0;
    private capacity = 16;
    protected activeOperations = 0;
    private activeTasks = new Set<
        TCNSNeuronActivationTask<TCollateralName, TNeuronName>
    >();

    // NEW: prevent re-entrant pump; defer extra runs
    private pumping = false;
    private needsPump = false;

    constructor(
        private readonly processor: (
            neuronActivationTask: TCNSNeuronActivationTask<
                TCollateralName,
                TNeuronName
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
        | TCNSNeuronActivationTask<TCollateralName, TNeuronName>
        | undefined {
        if (this.size === 0) return undefined;

        const neuronActivationTask = this.items[this.head];
        this.items[this.head] = undefined as any; // Clear reference
        this.head = (this.head + 1) % this.capacity;
        this.size--;

        return neuronActivationTask;
    }

    private enqueueItem(
        neuronActivationTask: TCNSNeuronActivationTask<
            TCollateralName,
            TNeuronName
        >
    ): void {
        if (this.size === this.capacity) {
            this.resize();
        }

        this.items[this.tail] = neuronActivationTask;
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
            const neuronActivationTask = this.dequeue()!;
            this.activeOperations++;
            this.activeTasks.add(neuronActivationTask);

            const ret = this.processor(neuronActivationTask);

            // Async branch
            if (ret && typeof (ret as any).then === 'function') {
                (ret as Promise<void | (() => void)>).then(
                    cb => {
                        // finish this item
                        this.activeOperations--;
                        this.activeTasks.delete(neuronActivationTask);
                        if (typeof cb === 'function') cb();

                        // schedule another pass (but don't re-enter if already pumping)
                        if (this.size > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                    },
                    err => {
                        this.activeOperations--;
                        this.activeTasks.delete(neuronActivationTask);
                        // resume if there's more work
                        if (this.size > 0 && this.canStartOperation) {
                            if (this.pumping) this.needsPump = true;
                            else this.pump();
                        }
                        throw err; // let it crash "honestly"
                    }
                );
                // Do not break: if concurrency allows, start additional items in this pump
                continue;
            }

            // Sync branch
            this.activeOperations--;
            this.activeTasks.delete(neuronActivationTask);
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
        neuronActivationTask: TCNSNeuronActivationTask<
            TCollateralName,
            TNeuronName
        >
    ) {
        this.enqueueItem(neuronActivationTask);
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

    public getQueuedTasks(): TCNSNeuronActivationTask<
        TCollateralName,
        TNeuronName
    >[] {
        const result: TCNSNeuronActivationTask<TCollateralName, TNeuronName>[] =
            [];
        let index = this.head;
        for (let i = 0; i < this.size; i++) {
            result.push(this.items[index]);
            index = (index + 1) % this.capacity;
        }
        return result;
    }

    public getActiveTasks(): TCNSNeuronActivationTask<
        TCollateralName,
        TNeuronName
    >[] {
        return Array.from(this.activeTasks);
    }
}
