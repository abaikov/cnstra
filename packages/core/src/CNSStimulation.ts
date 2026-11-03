import type { ICNSCollateral } from '@cnstra/types';
import { TCNSStimulationOptions } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import { TCNSDendrite } from '@cnstra/types';
import { TCNSSubscriber } from '@cnstra/types';
import { CNSInstanceNeuronQueue } from './CNSInstanceNeuronQueue';
import { TCNSSignal } from '@cnstra/types';
import { TCNSNeuronActivationTask } from '@cnstra/types';
import { TCNSContextStore } from '@cnstra/types';
import { CNS } from './CNS';
import { ICNS } from '@cnstra/types';
import { TCNSNeuronActivationTaskFailure } from '@cnstra/types';
import { TCNSStimulationResponse } from '@cnstra/types';
import { TCNSStimulationDrain } from '@cnstra/types';

import { TCNSNeuronResponseReturn } from '@cnstra/types';
import { TCNSAxon } from '@cnstra/types';

/**
 * Internal, non-enumerable cache of the resolved dendrite on activation tasks we
 * create ourselves. Lets executeActivationTask skip the subscriber lookup on the
 * hot path. Tasks supplied externally via activate() simply lack it and fall
 * back to the lookup. Symbol-keyed so it never shows up in JSON/spread/keys.
 */
const TASK_DENDRITE = Symbol('cnstra.taskDendrite');
const TASK_ACTIVE_POSITION = Symbol('cnstra.taskActivePosition');
const TASK_PENDING_POSITION = Symbol('cnstra.taskPendingPosition');

/**
 * Per-activation context handed to a dendrite's `response`. Implemented as a
 * class so the accessors live once on the prototype and each activation
 * allocates a single object.
 */
class CNSDendriteContext {
    constructor(
        public readonly stimulation: any,
        public readonly abortSignal: AbortSignal | undefined,
        public readonly cns: any,
        // The activation this handler is running as. Held so `activationContext`
        // can be read off it; nothing else on the task is exposed.
        private readonly task?: TCNSNeuronActivationTask<any>
    ) {}
    // Prototype getter, not a constructor field: you only pay a single `cns.global`
    // read on the dendrites that actually reach for it. Value getter, so
    // `{ global }` destructuring is safe.
    get global(): unknown {
        return this.cns.global;
    }
    // The caller-supplied per-stimulation context (`stimulate(sig, {stimulationContext})`),
    // the same value on every hop — the environment-agnostic way to correlate logs to a
    // run (pass `{ stimulationId, attemptNumber }`). Prototype getter like `global`:
    // zero extra allocation, read only where a handler reaches for it.
    get stimulationContext(): unknown {
        return this.stimulation.options?.stimulationContext;
    }
    // This activation's own store - written by a response listener before the
    // activation ran. Prototype getter like the two above: nothing is allocated
    // for a handler that never reaches for it.
    get activationContext(): TCNSContextStore | undefined {
        return this.task?.activationContext;
    }
}

/**
 * Response object handed to onResponse listeners. Implemented as a class so
 * instances share a single monomorphic hidden class.
 */
class CNSStimulationResponseImpl {
    constructor(
        public readonly stimulation: CNSStimulation<any, any>,
        public readonly inputSignal: TCNSSignal<ICNSCollateral<unknown>> | undefined,
        public readonly outputSignal:
            | TCNSSignal<ICNSCollateral<unknown>>
            | undefined,
        public readonly queueLength: number,
        public readonly pendingActivations: number,
        public readonly activeActivations: number,
        public readonly hops: number | undefined,
        public readonly error: any,
        // The neuron that produced this response (present on both success and
        // throw paths). Lets name-based consumers resolve the task's neuron
        // reliably instead of guessing via the output collateral's owner.
        public readonly neuron: TCNSNeuron<any> | undefined,
        // When the dendrite response was invoked, and how long it took. Measured in
        // runStarter, the single entry point into a body, so every path -
        // sync, async, throw, rejection - reports the same way. Undefined for
        // responses that are not an activation.
        public readonly startedAt: number | undefined,
        public readonly duration: number | undefined,
        /**
         * The activations this response is about to create - already built, not
         * yet run. A listener can write into their `activationContext` here and
         * the dendrite reads it back; the engine enqueues these very objects
         * afterwards, on every path, and waits for an async listener first.
         *
         * Empty on a response that starts nothing (a sink, a failure, abort).
         */
        public readonly scheduledActivationTasks: readonly TCNSNeuronActivationTask<any>[] = EMPTY_TASKS,
        /**
         * The store of the activation that produced this response - what its own
         * handler reads as `ctx.activationContext`. Undefined when nothing was
         * attached, and on responses that are not an activation.
         */
        public readonly activationContext: TCNSContextStore | undefined = undefined
    ) {}
}

/** Shared empty array so a response that starts nothing allocates none. */
const EMPTY_TASKS: readonly TCNSNeuronActivationTask<any>[] = [];

/** The same, for a response whose signal has no output collateral. */
const EMPTY_SUBSCRIBERS: any[] = [];

export class CNSStimulation<
    TNeuron extends TCNSNeuron<any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {

    // --- Inlined activation queue (formerly CNSNeuronActivationPump) ---
    // Folded into the stimulation so a single run allocates one object instead
    // of also spinning up a separate pump object + its backing array.
    // Ring buffer; the backing array is allocated lazily on first enqueue.
    private qItems?: Array<TCNSNeuronActivationTask<TNeuron> | undefined>;
    private qHead = 0;
    private qTail = 0;
    private qSize = 0;
    private qCapacity = 4;
    private activeOperations = 0;
    // Lazily allocated: only populated while an async task is in flight; purely
    // synchronous stimulations never need it.
    private activeTasks?: TCNSNeuronActivationTask<TNeuron>[];
    // Re-entrancy guard for the pump loop.
    private pumping = false;
    private needsPump = false;
    // Nesting depth of the current synchronous turn. Only the outermost close
    // announces a drain - see beginTurn/endTurn.
    private turnDepth = 0;

    private readonly neuronVisitCounts?: number[];
    private readonly subscribersByCollateralIndex: TCNSSubscriber<TNeuron, TDendrite>[][];
    /** Read on every dequeue; both are fixed for the life of the stimulation. */
    private readonly concurrencyLimit: number;
    private readonly abortSignal?: AbortSignal;
    private readonly instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>;
    private scheduledCount = 0;
    // Activations belonging to signals of an in-progress array fan-out that have
    // not been handed to processResponse yet, so the task objects do not exist.
    // processResponse enqueues synchronously, so the first signal's whole subtree
    // drains before the second signal is even looked at; without this counter
    // that subtree's leaf sees an empty queue and reads as "all work done".
    // Counted in activations, not signals, so every public counter shares a unit.
    private reservedActivations = 0;
    // Lazily allocated: only needed while subscriber tasks wait for an async
    // onResponse to resolve before being enqueued.
    private pendingTasks?: TCNSNeuronActivationTask<TNeuron>[];
    // Lazily allocated: only allocated when a task actually fails.
    private failedTasks?: Array<TCNSNeuronActivationTaskFailure<TNeuron>>;
    // Completion is tracked eagerly via flags; the Promise is only materialized
    // if someone actually calls waitUntilComplete(). This avoids allocating a
    // Promise (the single most expensive setup cost) on every stimulate().
    private completed?: Promise<void>;
    private resolveCompleted?: () => void;
    private rejectCompleted?: (e: any) => void;
    private isCompleted = false;
    private completionError: any;
    private completionRejected = false;
    private onResponseError: Error | undefined;

    /**
     * The (already wrapped) response listener for this stimulation, or
     * undefined when there is neither a local nor any global listener.
     */
    private readonly onResponse?: (
        response: TCNSStimulationResponse
    ) => void | Promise<void>;

    /**
     * The (already wrapped) drain listener, or undefined when there is neither a
     * local nor any global one. When undefined, endTurn() bails immediately, so a
     * stimulation with no drain listener pays only the turn depth counter.
     */
    private readonly onDrain?: (drain: TCNSStimulationDrain) => void;

    constructor(
        public readonly cns: CNS<TNeuron, TDendrite>,
        instanceNeuronQueue: CNSInstanceNeuronQueue<TNeuron>,
        public readonly options?: TCNSStimulationOptions<TCNSStimulationResponse>,
        onResponse?: (
            response: TCNSStimulationResponse
        ) => void | Promise<void>,
        onDrain?: (drain: TCNSStimulationDrain) => void
    ) {
        this.onDrain = onDrain;
        this.instanceNeuronQueue = instanceNeuronQueue;
        this.onResponse = onResponse;
        this.concurrencyLimit = this.options?.concurrency ?? Infinity;
        this.abortSignal = this.options?.abortSignal;
        this.subscribersByCollateralIndex = cns.network.getSubscriberTable(
            this.options?.modality,
            this.options?.afferentPath
        );

        if (this.options?.maxNeuronHops) {
            this.neuronVisitCounts = [];
        }
    }

    private pushFailedTask(
        failure: TCNSNeuronActivationTaskFailure<TNeuron>
    ): void {
        (this.failedTasks ??= []).push(failure);
    }

    private finalizeResolve(): void {
        this.completionRejected = false;
        this.resolveCompleted?.();
    }

    private finalizeReject(error: any): void {
        this.completionRejected = true;
        this.completionError = error;
        this.rejectCompleted?.(error);
    }

    // ----- Inlined activation queue / pump -----

    private get canStartOperation(): boolean {
        // Both were read through an optional chain on every dequeue, and both are
        // fixed at construction.
        return (
            this.activeOperations < this.concurrencyLimit &&
            !this.abortSignal?.aborted
        );
    }

    private qResize(): void {
        const oldCapacity = this.qCapacity;
        const oldItems = this.qItems!;
        this.qCapacity = oldCapacity * 2;
        const newItems = new Array(this.qCapacity);

        let oldIndex = this.qHead;
        for (let i = 0; i < this.qSize; i++) {
            newItems[i] = oldItems[oldIndex];
            oldIndex = (oldIndex + 1) % oldCapacity;
        }

        this.qItems = newItems;
        this.qHead = 0;
        this.qTail = this.qSize;
    }

    private qDequeue(): TCNSNeuronActivationTask<TNeuron> | undefined {
        if (this.qSize === 0) return undefined;
        const items = this.qItems!;
        const task = items[this.qHead];
        items[this.qHead] = undefined; // Clear reference
        this.qHead = (this.qHead + 1) % this.qCapacity;
        this.qSize--;
        return task;
    }

    private qEnqueueItem(task: TCNSNeuronActivationTask<TNeuron>): void {
        if (!this.qItems) {
            this.qItems = new Array(this.qCapacity);
        } else if (this.qSize === this.qCapacity) {
            this.qResize();
        }
        this.qItems[this.qTail] = task;
        this.qTail = (this.qTail + 1) % this.qCapacity;
        this.qSize++;
    }

    /** Enqueue a task and drive the pump unless one is already running. */
    private qEnqueue(task: TCNSNeuronActivationTask<TNeuron>): void {
        this.qEnqueueItem(task);
        if (!this.pumping) this.pump();
        else this.needsPump = true;
    }

    private qGetQueuedTasks(): TCNSNeuronActivationTask<TNeuron>[] {
        const result: TCNSNeuronActivationTask<TNeuron>[] = [];
        if (!this.qItems) return result;
        let index = this.qHead;
        for (let i = 0; i < this.qSize; i++) {
            result.push(this.qItems[index]!);
            index = (index + 1) % this.qCapacity;
        }
        return result;
    }

    private pump(): void {
        if (this.pumping) {
            this.needsPump = true;
            return;
        }
        this.pumping = true;

        try {
            while (this.canStartOperation && this.qSize > 0) {
                const task = this.qDequeue()!;
                this.activeOperations++;

                const ret = this.executeActivationTask(task);

                // Async branch
                if (ret && typeof (ret as any).then === 'function') {
                    // Only track tasks that are actually in flight across a
                    // tick; synchronous tasks complete before anyone can
                    // observe them.
                    this.addPositionedTask((this.activeTasks ??= []), task, TASK_ACTIVE_POSITION);
                    (ret as Promise<void | (() => void)>).then(
                        cb => {
                            this.activeOperations--;
                            this.removeActiveTask(task);
                            // One turn spans the callback and the follow-up
                            // pump: cb() itself enqueues and pumps, so without
                            // this the drain would be announced twice for one
                            // batch.
                            this.beginTurn();
                            try {
                                if (typeof cb === 'function') cb();

                                if (this.qSize > 0 && this.canStartOperation) {
                                    if (this.pumping) this.needsPump = true;
                                    else this.pump();
                                }
                            } catch (error) {
                                // The same machinery throw pump() guards below,
                                // but reached from a settled async activation.
                                // Rethrowing here would only turn into an
                                // unhandled rejection nobody can catch, so the
                                // run's error channel is the completion promise.
                                this.endRunWithError(error);
                            } finally {
                                this.endTurn();
                            }
                        },
                        err => {
                            this.activeOperations--;
                            this.removeActiveTask(task);
                            this.beginTurn();
                            try {
                                if (this.qSize > 0 && this.canStartOperation) {
                                    if (this.pumping) this.needsPump = true;
                                    else this.pump();
                                }
                            } finally {
                                this.endTurn();
                            }
                            throw err; // let it crash "honestly"
                        }
                    );
                    // Do not break: if concurrency allows, start additional items
                    continue;
                }

                // Sync branch (task was never added to activeTasks)
                this.activeOperations--;
                if (typeof ret === 'function') (ret as () => void)();
            }
        } catch (error) {
            // A throw out of the loop - today that is the hop-limit guard in
            // createSubscriberQueueItem, firing while a settled activation
            // dispatches its subscribers - used to unwind straight past the
            // `pumping = false` that lived here, leaving the flag set forever:
            // every later enqueue and async completion then took the "already
            // pumping" branch, so tryResolveCompleted was never reached again
            // and waitUntilComplete() never settled. Now the flag is reset in
            // `finally`, the run ends with this error, and the error still
            // propagates to whoever drove the pump.
            this.endRunWithError(error);
            throw error;
        } finally {
            this.pumping = false;
        }

        // If async completions or enqueues requested another pass, do exactly
        // one more, non-recursively.
        if (this.needsPump) {
            this.needsPump = false;
            this.pump();
        }
    }

    /**
     * Open a synchronous turn. Turns nest: a drain is announced only when the
     * outermost one closes, so an enqueue that happens while the pump is already
     * running does not produce its own boundary.
     */
    private beginTurn(): void {
        this.turnDepth++;
    }

    /**
     * Close a synchronous turn and, if it was the outermost and nothing more can
     * run without yielding to the event loop, announce the drain.
     *
     * This is the only place the synchronous frontier is observable. A response
     * cannot serve the purpose: responses are emitted when an activation
     * *finishes*, but a turn just as often ends when one *starts* and returns a
     * promise - at which point there is nothing left to emit a response from.
     */
    private endTurn(): void {
        if (--this.turnDepth > 0) return;
        const onDrain = this.onDrain;
        if (!onDrain) return;
        // Still mid-pump, or work is runnable right now: not a boundary.
        if (this.pumping) return;
        if (this.qSize > 0 && this.canStartOperation) return;
        // Hold the turn open across the callback so that a stimulate()/
        // enqueueTasks() call from inside it cannot recurse into another drain.
        this.turnDepth++;
        try {
            onDrain({
                stimulation: this,
                queueLength: this.pendingActivations + this.activeOperations,
                pendingActivations: this.pendingActivations,
                activeActivations: this.activeOperations,
            } as TCNSStimulationDrain);
        } finally {
            this.turnDepth--;
        }
    }

    /**
     * Activations that exist (or are reserved) but whose dendrite response has
     * not been invoked yet: sitting in the ring buffer, created and held in
     * pendingTasks, or reserved by an array fan-out mid-dispatch. Subscribers
     * parked behind an async onResponse land here too - their body has not run.
     */
    private get pendingActivations(): number {
        return this.qSize + this.scheduledCount + this.reservedActivations;
    }

    /**
     * End the run because the machinery itself threw. Dendrite bodies never get
     * here - runStarter catches those and records them as failed tasks; what
     * lands here is a throw from dispatch, today the hop-limit guard in
     * createSubscriberQueueItem. Nothing settles the counters after such a
     * throw, so completion has to be forced: without it the stimulation neither
     * resolves nor rejects, and a worker holds a job that never finishes and
     * never fails.
     */
    private endRunWithError(error: unknown): void {
        if (this.isCompleted) return;
        this.isCompleted = true;
        this.finalizeReject(
            error instanceof Error ? error : new Error(String(error))
        );
    }

    private tryResolveCompleted(): void {
        if (this.isCompleted) return;
        const noActive = this.activeOperations === 0;
        const noPending = this.pendingActivations === 0;
        const aborted = !!this.options?.abortSignal?.aborted;

        if ((noPending && noActive) || (aborted && noActive && !noPending)) {
            // When completing due to abort, mark all remaining queued tasks as aborted
            if (aborted) {
                const queuedTasks = this.qGetQueuedTasks();

                for (const task of [...queuedTasks]) {
                    const alreadyTracked = this.failedTasks?.some(
                        ft => ft.task === task
                    );
                    if (!alreadyTracked) {
                        this.pushFailedTask({
                            task,
                            error: new Error(
                                'Task aborted - not started due to abort signal'
                            ),
                            aborted: true,
                        });
                    }
                }

                this.isCompleted = true;
                // Announce the ending ONLY when nothing else did. An abort that
                // lands after the queue already drained still ends through a real
                // activation, which emitted its own `queueLength === 0` response;
                // adding a second one there would double-count the hop, race two
                // terminal flushes against each other, and open a second root span
                // for one run. It is the queued-work case — where no activation
                // ever settles to zero — that would otherwise wait forever.
                if (!noPending) this.emitAbortedResponse();
                this.finalizeReject(new Error('Stimulation aborted'));
                return;
            }

            this.isCompleted = true;
            // If there are failed tasks or onResponse error, reject the promise
            // Otherwise resolve it
            const failedCount = this.failedTasks?.length ?? 0;
            if (failedCount > 0 || this.onResponseError) {
                const error =
                    this.onResponseError ||
                    new Error(
                        `Stimulation completed with ${failedCount} failed task(s)`
                    );
                this.finalizeReject(error);
            } else {
                this.finalizeResolve();
            }
        }
    }

    public waitUntilComplete(): Promise<void> {
        if (this.completed) return this.completed;
        // Already completed before anyone awaited: hand back a settled promise.
        if (this.isCompleted) {
            this.completed = this.completionRejected
                ? Promise.reject(this.completionError)
                : Promise.resolve();
            return this.completed;
        }
        // Materialize the promise now and capture its resolvers for later.
        this.completed = new Promise<void>((resolve, reject) => {
            this.resolveCompleted = resolve;
            this.rejectCompleted = reject;
        });
        return this.completed;
    }

    /**
     * Returns all current activation tasks: queued, active, and pending (scheduled but not yet enqueued)
     */
    public getAllActivationTasks(): TCNSNeuronActivationTask<TNeuron>[] {
        const queuedTasks = this.qGetQueuedTasks();
        const activeTasks = this.activeTasks ?? EMPTY_TASKS;
        const pendingTasks = this.pendingTasks ?? EMPTY_TASKS;
        return [...queuedTasks, ...activeTasks, ...pendingTasks];
    }

    private getSubscribers(collateral: ICNSCollateral<unknown>): TCNSSubscriber<TNeuron, TDendrite>[] {
        return this.subscribersByCollateralIndex[collateral.index] ?? (EMPTY_SUBSCRIBERS as TCNSSubscriber<TNeuron, TDendrite>[]);
    }

    private addPositionedTask(
        tasks: TCNSNeuronActivationTask<TNeuron>[],
        task: TCNSNeuronActivationTask<TNeuron>,
        positionKey: symbol
    ): void {
        (task as any)[positionKey] = tasks.length;
        tasks.push(task);
    }

    private removePositionedTask(
        tasks: TCNSNeuronActivationTask<TNeuron>[] | undefined,
        task: TCNSNeuronActivationTask<TNeuron>,
        positionKey: symbol
    ): void {
        if (tasks === undefined) return;
        const position = (task as any)[positionKey] as number | undefined;
        if (position === undefined || tasks[position] !== task) return;
        const lastTask = tasks.pop()!;
        if (lastTask !== task) {
            tasks[position] = lastTask;
            (lastTask as any)[positionKey] = position;
        }
        (task as any)[positionKey] = undefined;
    }

    private removeActiveTask(task: TCNSNeuronActivationTask<TNeuron>): void {
        this.removePositionedTask(this.activeTasks, task, TASK_ACTIVE_POSITION);
    }

    private removePendingTask(task: TCNSNeuronActivationTask<TNeuron>): void {
        this.removePositionedTask(this.pendingTasks, task, TASK_PENDING_POSITION);
    }

    /**
     * Returns all tasks that failed or were aborted
     */
    public getFailedTasks(): Array<TCNSNeuronActivationTaskFailure<TNeuron>> {
        return this.failedTasks ? [...this.failedTasks] : [];
    }

    /**
     * The current outstanding frontier — every task that has not completed:
     * queued, active, and pending (awaiting an async onResponse), plus any
     * failed/aborted tasks. This is the set to persist for resume: re-activating
     * it re-runs exactly the not-yet-done work. Safe to call at any point during
     * a run (for progress) or after it fails.
     *
     * Each task appears exactly once. The two sources overlap: aborting marks
     * every still-queued task as failed without dequeuing it, so a task sits in
     * the ring buffer AND in failedTasks. Concatenating them blindly handed the
     * broker a checkpoint with the whole queued frontier listed twice, and the
     * resumed run re-executed every one of those tasks a second time - duplicate
     * charges, emails and POSTs on every graceful shutdown.
     */
    public getOutstandingTasks(): TCNSNeuronActivationTask<TNeuron>[] {
        const seen = new Set<TCNSNeuronActivationTask<TNeuron>>();
        const outstanding: TCNSNeuronActivationTask<TNeuron>[] = [];
        const add = (task: TCNSNeuronActivationTask<TNeuron>) => {
            if (seen.has(task)) return;
            seen.add(task);
            outstanding.push(task);
        };
        for (const task of this.getAllActivationTasks()) add(task);
        for (const failure of this.getFailedTasks()) add(failure.task);
        return outstanding;
    }

    /**
     * Enqueue activation tasks directly into the stimulation queue
     */
    public enqueueTasks(
        tasks: TCNSNeuronActivationTask<TNeuron>[]
    ): void {
        this.beginTurn();
        try {
            for (const task of tasks) {
                this.qEnqueue(task);
            }
            this.tryResolveCompleted();
        } finally {
            this.endTurn();
        }
    }

    protected get concurrencyEnabled(): boolean {
        return (
            this.options?.concurrency !== undefined &&
            this.options?.concurrency > 0
        );
    }

    protected createSubscriberQueueItem(
        subscriber: TCNSSubscriber<TNeuron, TDendrite>,
        inputSignal?: TCNSSignal<ICNSCollateral<unknown>>
    ) {
        const neuronVisitCounts = this.neuronVisitCounts;
        if (neuronVisitCounts !== undefined) {
            const neuronIndex = subscriber.neuron.index;
            const neuronVisitCount = neuronVisitCounts[neuronIndex] ?? 0;
            if (neuronVisitCount >= this.options!.maxNeuronHops!) {
                throw new Error(
                    `Max neuron hops reached when trying to enqueue subscriber`
                );
            }
            neuronVisitCounts[neuronIndex] = neuronVisitCount + 1;
        }

        const neuronActivationTask: TCNSNeuronActivationTask<TNeuron> = {
            neuron: subscriber.neuron,
            dendriteCollateral: subscriber.dendrite.collateral as ICNSCollateral<unknown>,
            input: inputSignal,
        };
        // Cache the resolved subscriber so executeActivationTask can skip the
        // lookup (invisible to JSON/spread thanks to the Symbol key).
        (neuronActivationTask as any)[TASK_DENDRITE] = subscriber;
        (neuronActivationTask as any)[TASK_ACTIVE_POSITION] = undefined;
        (neuronActivationTask as any)[TASK_PENDING_POSITION] = undefined;
        return neuronActivationTask;
    }

    private executeActivationTask(
        neuronActivationTask: TCNSNeuronActivationTask<TNeuron>
    ) {
        // Fast path: tasks we created carry their resolved subscriber. Tasks
        // supplied externally via activate() don't, so fall back to a lookup.
        let subscriber = (neuronActivationTask as any)[TASK_DENDRITE] as
            | TCNSSubscriber<TNeuron, TDendrite>
            | undefined;
        if (!subscriber) {
            const subscribers = this.getSubscribers(
                neuronActivationTask.dendriteCollateral
            );
            for (let i = 0; i < subscribers.length; i++) {
                if (subscribers[i].neuron === neuronActivationTask.neuron) {
                    subscriber = subscribers[i];
                    break;
                }
            }
        }
        if (!subscriber) {
            // Task failed: subscriber not found
            const error = new Error(`Subscriber not found for activation task`);
            this.pushFailedTask({
                task: neuronActivationTask,
                error,
                aborted: false,
            });
            // Report it like every other failure. Skipping this left a lookup
            // failure invisible to listeners, so one in the tail ended the
            // stimulation without a final response and queueLength never hit 0.
            // Reported from the thunk, not inline: pump only decrements
            // activeOperations before invoking what we return.
            return () => {
                this.processResponseOrResponses(
                    undefined,
                    neuronActivationTask.input,
                    undefined,
                    error,
                    undefined,
                    neuronActivationTask.activationContext
                );
            };
        }

        const neuron = subscriber.neuron;
        const dendrite = subscriber.dendrite as TDendrite;

        const inputSignal = neuronActivationTask.input;

        // Fast path: with no per-neuron concurrency limit there is nothing to
        // gate, so run inline instead of allocating a starter thunk and going
        // through the queue.
        const concurrency = (neuron as { concurrency?: number }).concurrency;
        if (concurrency === undefined || concurrency <= 0) {
            return this.runStarter(
                neuron,
                dendrite,
                inputSignal,
                neuronActivationTask
            );
        }
        return this.instanceNeuronQueue.run(neuron, () =>
            this.runStarter(
                neuron,
                dendrite,
                inputSignal,
                neuronActivationTask
            )
        );
    }

    private runStarter(
        neuron: TNeuron,
        dendrite: TDendrite,
        inputSignal: TCNSSignal<ICNSCollateral<unknown>> | undefined,
        neuronActivationTask: TCNSNeuronActivationTask<TNeuron>
    ): (() => void) | Promise<() => void> {
        let response: TCNSNeuronResponseReturn<TCNSAxon>;
        // The single point where a dendrite response is entered — so one stamp here
        // covers the sync, async, throw and rejection paths alike.
        //
        // Read only when something will look at it. Both this stamp and the
        // `Date.now()` that turns it into a duration escape solely into the
        // response object, which is built only when a listener exists: with none,
        // `processResponse` returns at its fast path without touching either. A
        // synchronous organism with no observer is the engine's headline case and
        // should not pay two clock reads per hop for numbers nobody reads.
        const startedAt = this.onResponse === undefined ? undefined : Date.now();
        try {
            response = dendrite.response(
                inputSignal?.payload,
                neuron.axon,
                new CNSDendriteContext(
                    this,
                    this.options?.abortSignal,
                    this.cns,
                    neuronActivationTask
                ) as any
            );
        } catch (error) {
            // Sync error occurred
            const isAborted = this.options?.abortSignal?.aborted ?? false;
            this.pushFailedTask({
                task: neuronActivationTask,
                error:
                    error instanceof Error
                        ? error
                        : new Error(String(error)),
                aborted: isAborted,
            });
            // Deferred to the thunk so the response is built after pump has
            // decremented activeOperations for this task - otherwise the error
            // response reports one in-flight operation too many.
            return () => {
                this.processResponseOrResponses(
                    neuron,
                    inputSignal as any,
                    undefined,
                    error,
                    startedAt,
                    neuronActivationTask.activationContext
                );
            };
        }

        const maxDuration = (neuron as any).maxDuration as
            | number
            | undefined;

        if (response instanceof Promise || maxDuration) {
            // Only materialize a Promise on the genuinely async path. The
            // sync path below never touches these, so building them here
            // would allocate a throwaway Promise on every activation.
            const asPromise: Promise<
                | TCNSSignal<ICNSCollateral<unknown>>
                | TCNSSignal<ICNSCollateral<unknown>>[]
                | undefined
            > =
                response instanceof Promise
                    ? response
                    : Promise.resolve(response as any);

            const timedPromise =
                maxDuration && maxDuration > 0
                    ? new Promise<
                          | TCNSSignal<ICNSCollateral<unknown>>
                          | TCNSSignal<ICNSCollateral<unknown>>[]
                          | undefined
                      >((resolve, reject) => {
                          const t = setTimeout(() => {
                              const err = new Error(
                                  `Neuron exceeded maxDuration ${maxDuration}ms`
                              );
                              reject(err);
                          }, maxDuration);
                          asPromise.then(
                              v => {
                                  clearTimeout(t);
                                  resolve(v);
                              },
                              e => {
                                  clearTimeout(t);
                                  reject(e);
                              }
                          );
                      })
                    : asPromise;

            return timedPromise.then(
                signal => {
                    return () => {
                        return this.processResponseOrResponses(
                            neuron,
                            inputSignal as any,
                            signal as
                                | TCNSSignal<ICNSCollateral<unknown>>
                                | TCNSSignal<ICNSCollateral<unknown>>[]
                                | undefined,
                            undefined,
                            startedAt,
                            neuronActivationTask.activationContext
                        );
                    };
                },
                error => {
                    return () => {
                        // Track failed task
                        const isAborted =
                            this.options?.abortSignal?.aborted ?? false;
                        this.pushFailedTask({
                            task: neuronActivationTask,
                            error:
                                error instanceof Error
                                    ? error
                                    : new Error(String(error)),
                            aborted: isAborted,
                        });
                        return this.processResponseOrResponses(
                            neuron,
                            inputSignal as any,
                            undefined,
                            error,
                            startedAt,
                            neuronActivationTask.activationContext
                        );
                    };
                }
            );
        } else {
            return () => {
                return this.processResponseOrResponses(
                    neuron,
                    inputSignal as any,
                    response as
                        | TCNSSignal<ICNSCollateral<unknown>>
                        | TCNSSignal<ICNSCollateral<unknown>>[]
                        | undefined,
                    undefined,
                    startedAt,
                    neuronActivationTask.activationContext
                );
            };
        }
    }

    protected processResponseOrResponses(
        emitter: TNeuron | undefined,
        inputSignal?: TCNSSignal<ICNSCollateral<unknown>>,
        outputSignalOrSignals?:
            | TCNSSignal<ICNSCollateral<unknown>>
            | TCNSSignal<ICNSCollateral<unknown>>[],
        error?: any,
        startedAt?: number,
        // The store of the activation that produced this response — the same
        // object its own handler reads as `ctx.activationContext`. Carried so a
        // recorder can put it in the task's history row without having to hold
        // the task itself.
        activationContext?: TCNSContextStore
    ): void {
        // The activation settled HERE, once, whatever it returned. Measuring
        // inside the per-signal loop below would charge each later signal for the
        // synchronous subtree the earlier ones already drained — one activation
        // reported as several, each longer than the last.
        const duration =
            startedAt === undefined ? undefined : Date.now() - startedAt;

        // Handle array of signals
        if (Array.isArray(outputSignalOrSignals)) {
            // If array is empty, still call processResponse once to trigger onResponse
            if (outputSignalOrSignals.length === 0) {
                this.processResponse(
                    emitter,
                    inputSignal,
                    undefined,
                    error,
                    startedAt,
                    duration,
                    activationContext
                );
                return;
            }

            // Reserve the whole fan-out before dispatching any of it. Counted in
            // activations rather than signals, so pre-resolve each signal's
            // subscriber count - getSubscribers is a single map lookup. On the
            // error path processResponse schedules nothing, so nothing is reserved.
            let perSignal: number[] | undefined;
            if (!error) {
                perSignal = new Array<number>(outputSignalOrSignals.length);
                let reserved = 0;
                for (let i = 0; i < outputSignalOrSignals.length; i++) {
                    const c = outputSignalOrSignals[i]?.collateral;
                    const n = c
                        ? this.getSubscribers(c).length
                        : 0;
                    perSignal[i] = n;
                    reserved += n;
                }
                this.reservedActivations += reserved;
            }
            // The increment/decrement pair is balanced per level, so a nested
            // fan-out inside signal[0]'s subtree composes correctly.
            let dispatchIndex = 0;
            try {
                for (
                    ;
                    dispatchIndex < outputSignalOrSignals.length;
                    dispatchIndex++
                ) {
                    if (perSignal)
                        this.reservedActivations -= perSignal[dispatchIndex];
                    this.processResponse(
                        emitter,
                        inputSignal,
                        outputSignalOrSignals[dispatchIndex],
                        error,
                        startedAt,
                        duration,
                        activationContext
                    );
                }
            } finally {
                // A throw out of a dispatch (the hop-limit guard) skips the
                // decrements for the signals we never reached. Leaving them
                // reserved keeps pendingActivations permanently above zero, so
                // every later count - the drain payload, the completion check -
                // reports work that will never exist. Release the remainder on
                // the way out; on the normal path dispatchIndex is past the
                // end and this loop does nothing.
                if (perSignal) {
                    for (
                        let j = dispatchIndex + 1;
                        j < perSignal.length;
                        j++
                    ) {
                        this.reservedActivations -= perSignal[j];
                    }
                }
            }
            return;
        }

        // Handle single signal
        this.processResponse(
            emitter,
            inputSignal,
            outputSignalOrSignals,
            error,
            startedAt,
            duration,
            activationContext
        );
    }

    /**
     * The one response an aborted run emits: no neuron, no signals, an empty
     * queue. It exists so `queueLength === 0` — the completion condition every
     * listener uses — is reached on the abort path too. Listener errors are
     * swallowed: the run is already over and rejecting, and there is nothing
     * left to fail.
     */
    private emitAbortedResponse(): void {
        const onResponse = this.onResponse;
        if (!onResponse) return;

        try {
            void onResponse(
                new CNSStimulationResponseImpl(
                    this,
                    undefined,
                    undefined,
                    0,
                    0,
                    0,
                    undefined,
                    new Error('Stimulation aborted'),
                    undefined,
                    undefined,
                    undefined
                ) as TCNSStimulationResponse
            );
        } catch (e) {
            this.onResponseError =
                e instanceof Error ? e : new Error(String(e));
        }
    }

    protected processResponse(
        emitter: TNeuron | undefined,
        inputSignal?: TCNSSignal<ICNSCollateral<unknown>>,
        outputSignal?: TCNSSignal<ICNSCollateral<unknown>>,
        error?: any,
        startedAt?: number,
        duration?: number,
        activationContext?: TCNSContextStore
    ): void {
        const collateral = outputSignal?.collateral;
        // `getSubscribers` already answers with a shared empty array, and a
        // response with no output collateral is every terminal and every failed
        // one — so neither branch should allocate.
        const subscribers = collateral
            ? this.getSubscribers(collateral)
            : EMPTY_SUBSCRIBERS;
        const onResponse = this.onResponse;

        // Fast path: with no response listener there is nothing to observe the
        // intermediate state, so we skip building the response object and
        // tracking pending tasks.
        if (!onResponse) {
            if (collateral && !error) {
                const n = subscribers.length;
                if (n > 0) {
                    const tasks: TCNSNeuronActivationTask<TNeuron>[] =
                        new Array(n);
                    for (let i = 0; i < n; i++) {
                        tasks[i] = this.createSubscriberQueueItem(
                            subscribers[i],
                            outputSignal
                        );
                    }
                    this.scheduledCount += n;
                    for (let i = 0; i < n; i++) {
                        this.scheduledCount--;
                        this.qEnqueue(tasks[i]);
                    }
                }
            }
            this.tryResolveCompleted();
            return;
        }

        // Built only when there is something to put in it. A response that
        // schedules nothing — a sink neuron, a failure, the terminal signal —
        // hands the shared empty array to the response object instead.
        let subscriberActivationTasks: TCNSNeuronActivationTask<TNeuron>[] =
            EMPTY_TASKS as TCNSNeuronActivationTask<TNeuron>[];

        if (collateral && !error && subscribers.length > 0) {
            // Held in `pendingTasks` from the moment they exist, not only while
            // an async listener parks them: `queueLength` counts them as pending
            // activations immediately, and `getAllActivationTasks()` has to
            // agree with that count — a synchronous listener can read both.
            const pending = (this.pendingTasks ??= []);
            subscriberActivationTasks = new Array(subscribers.length);
            for (let i = 0; i < subscribers.length; i++) {
                const task = this.createSubscriberQueueItem(
                    subscribers[i],
                    outputSignal
                );
                subscriberActivationTasks[i] = task;
                this.addPositionedTask(pending, task, TASK_PENDING_POSITION);
            }
        }
        this.scheduledCount += subscriberActivationTasks.length;

        // After we pre-enqueued all subscribers, we can trace the response
        let maybePromise: void | Promise<void>;
        try {
            maybePromise = onResponse(
                new CNSStimulationResponseImpl(
                    this,
                    inputSignal,
                    outputSignal,
                    this.pendingActivations + this.activeOperations,
                    this.pendingActivations,
                    this.activeOperations,
                    this.options?.maxNeuronHops && emitter
                        ? this.neuronVisitCounts?.[emitter.index] ?? 0
                        : undefined,
                    error,
                    emitter,
                    startedAt,
                    duration,
                    subscriberActivationTasks,
                    activationContext
                ) as TCNSStimulationResponse
            );
        } catch (e) {
            // Remember the error but don't reject immediately - wait for all tasks to complete
            this.onResponseError =
                e instanceof Error ? e : new Error(String(e));
            // Still enqueue subscribers and continue processing
            for (let i = 0; i < subscriberActivationTasks.length; i++) {
                this.scheduledCount--;
                this.removePendingTask(subscriberActivationTasks[i]);
                this.qEnqueue(subscriberActivationTasks[i]);
            }
            this.tryResolveCompleted();
            return;
        }

        // If onResponse returned a promise, wait for it before enqueuing subscribers
        if (maybePromise && typeof maybePromise.then === 'function') {
            // These tasks stay in scheduledCount until the listener settles, so
            // they keep reading as pending activations - correctly: they exist,
            // and their dendrite response has not been invoked.
            (maybePromise as Promise<void>).then(
                () => {
                    // Resuming from a settled listener starts a fresh turn, the
                    // same as resuming from a settled neuron body.
                    this.beginTurn();
                    try {
                        for (
                            let i = 0;
                            i < subscriberActivationTasks.length;
                            i++
                        ) {
                            this.scheduledCount--;
                            this.removePendingTask(
                                subscriberActivationTasks[i]
                            );
                            this.qEnqueue(subscriberActivationTasks[i]);
                        }
                        this.tryResolveCompleted();
                    } finally {
                        this.endTurn();
                    }
                },
                error => {
                    // Remember the error but don't reject immediately - wait for all tasks to complete
                    this.onResponseError =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    this.beginTurn();
                    try {
                        // Still enqueue subscribers and continue processing
                        for (
                            let i = 0;
                            i < subscriberActivationTasks.length;
                            i++
                        ) {
                            this.scheduledCount--;
                            this.removePendingTask(
                                subscriberActivationTasks[i]
                            );
                            this.qEnqueue(subscriberActivationTasks[i]);
                        }
                        this.tryResolveCompleted();
                    } finally {
                        this.endTurn();
                    }
                }
            );
            return;
        }

        // Sync path: enqueue subscribers immediately
        for (let i = 0; i < subscriberActivationTasks.length; i++) {
            this.scheduledCount--;
            this.removePendingTask(subscriberActivationTasks[i]);
            this.qEnqueue(subscriberActivationTasks[i]);
        }
        this.tryResolveCompleted();
    }

    public responseToSignal(
        signalOrSignals:
            | TCNSSignal<ICNSCollateral<unknown>>
            | TCNSSignal<ICNSCollateral<unknown>>[]
    ): void {
        // The initial dispatch is a turn: everything reachable synchronously from
        // this signal runs before stimulate() returns, and the drain that follows
        // is the first batch boundary.
        this.beginTurn();
        try {
            // Handle array of signals
            if (Array.isArray(signalOrSignals)) {
                // For initial stimulation: signals are outputs (to find subscribers)
                // In onResponse, inputSignal will be undefined for initial stimulation
                this.processResponseOrResponses(
                    undefined,
                    undefined,
                    signalOrSignals
                );
                return;
            }

            // For initial stimulation: signal is the output (to find subscribers)
            // In onResponse, inputSignal will be undefined for initial stimulation
            this.processResponse(undefined, undefined, signalOrSignals);
            this.tryResolveCompleted();
        } finally {
            this.endTurn();
        }
    }
}
