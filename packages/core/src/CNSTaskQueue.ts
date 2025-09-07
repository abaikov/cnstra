export class CNSTaskQueue {
    private pumping = false;
    private needsPump = false;
    private activeOperations = 0;

    private items: Array<{
        task: () => (() => void) | Promise<() => void>;
        resolve: () => void;
        reject: (e: any) => void;
    }> = [];

    constructor(private readonly concurrency?: number) {}

    private get canStartOperation(): boolean {
        const limit = this.concurrency ?? Infinity;
        return this.activeOperations < limit;
    }

    enqueue(task: () => (() => void) | Promise<() => void>): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.items.push({ task, resolve, reject });
            if (!this.pumping) this.pump();
            else this.needsPump = true;
        });
    }

    private pump() {
        if (this.pumping) {
            this.needsPump = true;
            return;
        }
        this.pumping = true;

        while (this.canStartOperation && this.items.length > 0) {
            const { task, resolve, reject } = this.items.shift()!;
            this.activeOperations++;

            try {
                const ret = task();
                if (ret && typeof (ret as any).then === 'function') {
                    (ret as Promise<() => void>).then(
                        cb => {
                            try {
                                if (typeof cb === 'function') cb();
                                resolve();
                            } finally {
                                this.activeOperations--;
                                if (
                                    this.items.length > 0 &&
                                    this.canStartOperation
                                ) {
                                    if (this.pumping) this.needsPump = true;
                                    else this.pump();
                                }
                            }
                        },
                        err => {
                            try {
                                reject(err);
                            } finally {
                                this.activeOperations--;
                                if (
                                    this.items.length > 0 &&
                                    this.canStartOperation
                                ) {
                                    if (this.pumping) this.needsPump = true;
                                    else this.pump();
                                }
                            }
                        }
                    );
                    break;
                } else {
                    try {
                        if (typeof ret === 'function') (ret as () => void)();
                        resolve();
                    } finally {
                        this.activeOperations--;
                    }
                }
            } catch (e) {
                try {
                    reject(e);
                } finally {
                    this.activeOperations--;
                }
            }
        }

        this.pumping = false;
        if (this.needsPump) {
            this.needsPump = false;
            this.pump();
        }
    }
}
