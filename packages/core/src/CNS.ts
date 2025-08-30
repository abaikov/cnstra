import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { CNSCollateral } from './CNSCollateral';
import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';
import { CNSStimulationContextStore } from './CNSStimulationContextStore';

/**
 * Small helpers
 */
const asArray = <T>(x: T | T[]) => (Array.isArray(x) ? x : [x]);
const isPromise = (v: unknown): v is Promise<unknown> =>
    !!v && typeof (v as any).then === 'function';

/**
 * Minimal, GC-friendly deque (ring-buffer-ish) with O(1) push/shift.
 * Avoids Array.shift() O(n) tail copies on large queues.
 */
class Deque<T> {
    private a: T[] = [];
    private head = 0;

    push(x: T) {
        this.a.push(x);
    }

    shift(): T | undefined {
        if (this.head >= this.a.length) return undefined;
        const v = this.a[this.head++];
        // Periodic compaction to keep memory bounded:
        // when head grows big and passes half of array, slice the live tail.
        if (this.head > 1024 && this.head * 2 > this.a.length) {
            this.a = this.a.slice(this.head);
            this.head = 0;
        }
        return v;
    }

    get length() {
        return this.a.length - this.head;
    }

    // Optional convenience if you need to inspect without removing:
    // peek(): T | undefined { return this.a[this.head]; }
}

type TSubscriber<
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> = {
    neuron: TNeuron;
    dendrite: TDendrite;
};

type TQueueItem<TCollateralId extends string> = {
    collateralId: TCollateralId;
    payload: unknown;
    hops: number;
    spikeId: string;
};

export class CNS<
    TCollateralId extends string,
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> {
    /**
     * Fast lookup: collateralId -> list of (neuron, dendrite) subscribers.
     * Built once at construction time.
     */
    private subIndex = new Map<
        TCollateralId,
        TSubscriber<TNeuron, TDendrite>[]
    >();

    constructor(protected readonly neurons: TNeuron[]) {
        this.buildIndex();
    }

    private buildIndex() {
        this.subIndex.clear();
        for (const neuron of this.neurons) {
            for (const dendrite of neuron.dendrites) {
                const key = dendrite.collateral.id as TCollateralId;
                const arr = this.subIndex.get(key) ?? [];
                arr.push({ neuron, dendrite: dendrite as TDendrite });
                this.subIndex.set(
                    key,
                    arr as TSubscriber<TNeuron, TDendrite>[]
                );
            }
        }
    }

    /**
     * Fire-and-forget fan-out for a single queue item.
     *
     * Behavior:
     * - Synchronous dendrite responses enqueue their outgoing signals immediately.
     * - Asynchronous responses:
     *     • We DO NOT await them (no per-item barrier).
     *     • We attach `.then` to enqueue outgoing signals when ready.
     *     • We notify the scheduler when the first async for this item starts,
     *       and when the last async for this item settles.
     * - No error handling: we do not try/catch. Rejections bubble via wireRejectionToRun().
     *
     * Returns:
     *   boolean — whether this item launched any async work (>= 1 promises).
     */
    private fanOutFireAndForget(
        incoming: TQueueItem<TCollateralId>,
        allowType: ((t: TCollateralId) => boolean) | undefined,
        seen: Set<string>,
        queue: Deque<TQueueItem<TCollateralId>>,
        ctx: ICNSStimulationContextStore,
        onItemFirstAsyncStart: () => void, // called exactly once per item (on first async)
        onItemAllAsyncSettled: () => void, // called when this item's last async settles
        onAnyAsyncSettled: () => void, // called after every async settles (to pump again)
        wireRejectionToRun: (p: Promise<any>) => void // lets the run-level promise reject on first error
    ): boolean {
        const subscribers = this.subIndex.get(incoming.collateralId);
        if (!subscribers || subscribers.length === 0) return false;

        // Do not capture the entire `incoming` object in closures — copy only what we need.
        const nextHop = incoming.hops + 1;
        const spikeId = incoming.spikeId;

        const enqueueOut = (out: any) => {
            if (out == null) return;
            for (const spike of asArray(out)) {
                const t = spike.type as TCollateralId;
                if (allowType && !allowType(t)) continue;
                queue.push({
                    collateralId: t,
                    payload: spike.payload,
                    hops: nextHop,
                    spikeId,
                });
            }
        };

        // Track active async subscribers for THIS item.
        let openAsync = 0;
        let itemMarkedAsync = false;

        for (const { neuron, dendrite } of subscribers) {
            // Dedup to prevent double-processing within this spike cascade
            const dedupKey = `${neuron.id}::${incoming.collateralId}::${incoming.spikeId}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            const res = dendrite.response(incoming.payload, neuron.axon, {
                get: () => ctx.get(neuron.id),
                set: (value: any) => ctx.set(neuron.id, value),
            });

            if (isPromise(res)) {
                if (!itemMarkedAsync) {
                    itemMarkedAsync = true;
                    onItemFirstAsyncStart();
                }
                openAsync++;

                // We do NOT catch here; rejections are wired to the run-level promise.
                const p = (res as Promise<any>)
                    .then(out => {
                        enqueueOut(out);
                    })
                    .finally(() => {
                        // After any async settles:
                        openAsync--;
                        onAnyAsyncSettled();
                        if (openAsync === 0) {
                            onItemAllAsyncSettled();
                        }
                    });

                // Let the outer run observe (and reject on) this promise.
                wireRejectionToRun(p);
            } else {
                // Synchronous branch: enqueue immediately.
                enqueueOut(res);
            }
        }

        return itemMarkedAsync;
    }

    stimulate<
        TAfferentCollateralId extends TCollateralId,
        TAfferentCollateralPayload
    >(
        collateral: CNSCollateral<
            TAfferentCollateralId,
            TAfferentCollateralPayload
        >,
        payload: TAfferentCollateralPayload,
        opts?: {
            maxHops?: number;
            allowType?: (t: TCollateralId) => boolean;
            onTrace?: (e: {
                collateralId: TCollateralId;
                hops: number;
                payload: unknown;
            }) => void;
            abortSignal?: AbortSignal;
            spikeId?: string;
            ctx?: ICNSStimulationContextStore;
            /**
             * Max number of queue items processed "actively" at the same time.
             * - undefined / <= 0 => Infinity (fully parallel "fire-and-forget")
             * Concurrency counts ITEMS (not individual async subscribers).
             * An item is considered "active" if it launched at least one async subscriber
             * that hasn't settled yet. Items with only sync work complete immediately.
             */
            concurrency?: number;
        }
    ): Promise<void> | void {
        const ctx = opts?.ctx ?? new CNSStimulationContextStore();
        const spikeId = opts?.spikeId || Math.random().toString(36).slice(2);
        const maxHops = opts?.maxHops;
        const limit =
            (opts?.concurrency ?? 0) > 0 ? opts!.concurrency! : Infinity;

        // BFS queue backed by a Deque to avoid O(n) cost of Array.shift()
        const queue = new Deque<TQueueItem<TCollateralId>>();
        queue.push({
            collateralId: collateral.id,
            payload,
            hops: 0,
            spikeId,
        });

        // Used to avoid double-processing (neuronId + collateralId + spikeId)
        const seen = new Set<string>();

        /**
         * Number of "active" items currently in-flight.
         * - Increment when we start an item.
         * - If item had NO async, decrement immediately after fanOut.
         * - If item HAD async, decrement when its last async settles.
         */
        let activeItems = 0;

        /**
         * We return `void` if everything completed synchronously.
         * Otherwise we create a promise and:
         *  - resolve when queue is empty AND activeItems == 0
         *  - reject on the first async rejection
         */
        let doneResolve: (() => void) | null = null;
        let doneReject: ((err: any) => void) | null = null;
        let done: Promise<void> | null = null;

        const ensureDonePromise = () => {
            if (!done) {
                done = new Promise<void>((resolve, reject) => {
                    doneResolve = resolve;
                    doneReject = reject;
                });
            }
        };

        /**
         * Wire a subscriber promise to the run-level promise.
         * - If it rejects, we reject the whole run (first error wins).
         * - We do NOT catch-and-swallow; the original rejection still propagates.
         */
        const wireRejectionToRun = (p: Promise<any>) => {
            ensureDonePromise();
            p.then(
                () => {},
                err => {
                    if (doneReject) {
                        const rej = doneReject;
                        doneReject = null; // ensure first error wins
                        rej(err);
                    }
                    // Re-throw so this promise isn't considered "handled" internally.
                    throw err;
                }
            );
        };

        /**
         * Pump:
         * - Pulls items from the deque up to the concurrency limit.
         * - For each item:
         *   • emits onTrace
         *   • runs fire-and-forget fanOut
         *   • if NO async launched -> item completes immediately
         *   • if async launched -> item remains "active" until all its async settle
         * - After any async settles, we call pump() again (nudged by fanOut).
         *
         * Abort:
         * - If AbortSignal is aborted, we stop pulling more work.
         *   Already-launched async may still enqueue more items;
         *   caller controls cleanup/lifetime externally.
         */
        const pump = () => {
            while (queue.length && activeItems < limit) {
                if (opts?.abortSignal?.aborted) break;

                const item = queue.shift()!;
                // Trace BEFORE fanOut to reflect actual order
                opts?.onTrace?.({
                    collateralId: item.collateralId,
                    hops: item.hops,
                    payload: item.payload,
                });

                if (maxHops && item.hops >= maxHops) {
                    // Skip due to hop guard; try next.
                    continue;
                }

                // This item becomes "active" now (will be decremented immediately if it has no async)
                activeItems++;

                // Per-item async markers
                let itemMarkedAsync = false;

                const onItemFirstAsyncStart = () => {
                    if (!itemMarkedAsync) {
                        itemMarkedAsync = true;
                        ensureDonePromise();
                    }
                };

                const onItemAllAsyncSettled = () => {
                    activeItems--;
                    if (
                        activeItems === 0 &&
                        queue.length === 0 &&
                        doneResolve
                    ) {
                        const r = doneResolve;
                        doneResolve = null;
                        r();
                    }
                };

                const onAnyAsyncSettled = () => {
                    // After any async settles, try to pick more items (if under concurrency limit)
                    pump();
                };

                // Fan out (fire-and-forget)
                const launchedAsync = this.fanOutFireAndForget(
                    item as TQueueItem<TCollateralId>,
                    opts?.allowType,
                    seen,
                    queue,
                    ctx,
                    onItemFirstAsyncStart,
                    onItemAllAsyncSettled,
                    onAnyAsyncSettled,
                    wireRejectionToRun
                );

                // If the item had NO async, it completes immediately here.
                if (!launchedAsync) {
                    activeItems--;
                    // If fully drained and we had created a run-promise (unlikely here), resolve it.
                    if (
                        activeItems === 0 &&
                        queue.length === 0 &&
                        doneResolve
                    ) {
                        const r = doneResolve;
                        doneResolve = null;
                        r();
                    }
                    // Loop continues to pick more items in this same pump call.
                }
            }
        };

        // Initial kick
        pump();

        // If we never launched async and queue drained during the initial pump,
        // return void (purely synchronous run). Otherwise return the run-level promise.
        return done ?? undefined;
    }
}
