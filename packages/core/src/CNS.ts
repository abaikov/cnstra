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

    /**
     * Cached hashes for stable IDs to optimize dedup key generation.
     */
    private neuronHashes = new Map<string, number>();
    private collateralHashes = new Map<string, number>();

    constructor(protected readonly neurons: TNeuron[]) {
        this.buildIndex();
        this.precomputeHashes();
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
     * Precompute hashes for stable neuron and collateral IDs to optimize
     * dedup key generation during stimulation.
     */
    private precomputeHashes() {
        for (const neuron of this.neurons) {
            this.getHash(neuron.id, this.neuronHashes);
            for (const dendrite of neuron.dendrites) {
                this.getHash(dendrite.collateral.id, this.collateralHashes);
            }
        }
    }

    /**
     * Simple but effective hash function for string keys.
     */
    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    /**
     * Get or compute hash for a string, using cache for stable IDs.
     */
    private getHash(str: string, cache: Map<string, number>): number {
        let hash = cache.get(str);
        if (hash === undefined) {
            hash = this.simpleHash(str);

            // Simple cache management - remove oldest entry if cache gets too large
            if (cache.size > 1000) {
                // Remove oldest entry (first key in Map maintains insertion order)
                const oldestKey = cache.keys().next().value;
                if (oldestKey !== undefined) {
                    cache.delete(oldestKey);
                }
            }

            cache.set(str, hash);
        } else {
            // Move to end for LRU (delete + re-add updates position)
            cache.delete(str);
            cache.set(str, hash);
        }
        return hash;
    }

    /**
     * Create optimized dedup key using composite numeric hash.
     * This replaces string concatenation with faster numeric operations.
     * Includes hops to allow signals to pass through the same neuron at different levels.
     */
    private createDedupKey(
        neuronId: string,
        collateralId: string,
        spikeId: string,
        hops: number
    ): string {
        const nHash = this.getHash(neuronId, this.neuronHashes);
        const cHash = this.getHash(collateralId, this.collateralHashes);
        const sHash = this.simpleHash(spikeId); // Don't cache spike IDs (too many unique values)
        const hHash = this.simpleHash(hops.toString()); // Hash the hops level

        return `${nHash}:${cHash}:${sHash}:${hHash}`;
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
        enableDedup: boolean, // New parameter
        onItemFirstAsyncStart: () => void, // called exactly once per item (on first async)
        onItemAllAsyncSettled: () => void, // called when this item's last async settles
        onAnyAsyncSettled: () => void, // called after every async settles (to pump again)
        onTrace?: (trace: {
            collateralId: TCollateralId;
            hops: number;
            payload: unknown;
            queueLength: number;
            error?: Error;
            context: ICNSStimulationContextStore; // Pass the actual context store interface
        }) => void
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
            const dedupKey = enableDedup
                ? this.createDedupKey(
                      neuron.id,
                      incoming.collateralId,
                      incoming.spikeId,
                      incoming.hops
                  )
                : undefined; // Only dedup if enabled

            if (dedupKey && seen.has(dedupKey)) continue;
            if (dedupKey) seen.add(dedupKey);

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
                (res as Promise<any>).then(
                    out => {
                        enqueueOut(out);
                        // After successful async settles:
                        openAsync--;
                        onAnyAsyncSettled();
                        if (openAsync === 0) {
                            onItemAllAsyncSettled();
                        }
                    },
                    err => {
                        // Trace the error
                        onTrace?.({
                            collateralId: incoming.collateralId,
                            hops: incoming.hops,
                            payload: incoming.payload,
                            queueLength: queue.length,
                            error: err,
                            context: ctx, // Pass the context store interface
                        });

                        // After failed async settles:
                        openAsync--;
                        onAnyAsyncSettled();
                        if (openAsync === 0) {
                            onItemAllAsyncSettled();
                        }
                        // Error is already traced, just continue
                    }
                );

                // Fire-and-forget: no need to wire rejections
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
                queueLength: number;
                error?: Error;
                context: ICNSStimulationContextStore; // Pass the actual context store interface
            }) => void;
            abortSignal?: AbortSignal;
            spikeId?: string;
            ctx?: ICNSStimulationContextStore;
            /**
             * Factory method to create a new context store.
             * Useful for recovery scenarios where you want to restore state.
             */
            createContext?: () => ICNSStimulationContextStore;
            /**
             * Maximum number of signal processing operations active at once.
             * - Sync operations count for their brief execution time
             * - Async operations count until completion
             * - undefined / <= 0 => Infinity (no limit)
             * Maintains streaming flow - no artificial barriers or level synchronization.
             */
            concurrency?: number;
        }
    ): void {
        const ctx =
            opts?.ctx ??
            opts?.createContext?.() ??
            new CNSStimulationContextStore();
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
         * Number of operations currently being processed.
         * Both sync and async operations count toward this limit.
         * Streaming concurrency: no artificial barriers, just resource limiting.
         */
        let activeOperations = 0;

        /**
         * Fire-and-forget: we don't return promises, just trace errors.
         */

        /**
         * Streaming processor:
         * - Processes items from queue up to concurrency limit
         * - Each operation (sync/async) counts as one slot while active
         * - No level barriers - operations start as soon as slots are available
         * - Maintains fire-and-forget flow with proper backpressure
         *
         * Abort:
         * - If AbortSignal is aborted, stops pulling new work
         * - Already-launched operations continue to completion
         */
        const startOperation = () => {
            activeOperations++;
        };

        const finishOperation = () => {
            activeOperations--;
            // Stream processing: immediately try to start more work
            tryProcessMore();
        };

        const canStartOperation = (): boolean => {
            return activeOperations < limit && !opts?.abortSignal?.aborted;
        };

        const processItem = (item: TQueueItem<TCollateralId>) => {
            // Trace BEFORE processing to reflect actual order
            opts?.onTrace?.({
                collateralId: item.collateralId,
                hops: item.hops,
                payload: item.payload,
                queueLength: queue.length,
                context: ctx, // Pass the context store
            });

            if (maxHops && item.hops >= maxHops) {
                // Skip due to hop guard, but still finish the operation
                finishOperation();
                return;
            }

            // Simplified callbacks for streaming concurrency
            const onOperationComplete = () => {
                finishOperation();
            };

            const onAsyncStart = () => {
                // Already counted in startOperation(), nothing extra needed
            };

            // Fan out (fire-and-forget)
            const launchedAsync = this.fanOutFireAndForget(
                item,
                opts?.allowType,
                seen,
                queue,
                ctx,
                maxHops !== undefined, // Enable dedup only if maxHops is set
                onAsyncStart,
                onOperationComplete,
                tryProcessMore, // Continue streaming on any completion
                opts?.onTrace
            );

            // If sync operation, complete immediately
            if (!launchedAsync) {
                finishOperation();
            }
        };

        const tryProcessMore = () => {
            // Stream processing: start as many operations as concurrency allows
            while (queue.length && canStartOperation()) {
                const item = queue.shift()!;
                startOperation();
                processItem(item);
            }
        };

        // Start streaming processing
        tryProcessMore();

        // Fire-and-forget: always return void
    }
}
