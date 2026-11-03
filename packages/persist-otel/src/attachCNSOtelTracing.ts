import { context, trace, ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api';
import type { Context, Span, SpanContext, Tracer } from '@opentelemetry/api';
import type {
    ICNSCollateral,
    TCNSNeuron,
    TCNSNeuronActivationTask,
    TCNSSignal,
    TCNSStimulationResponse,
} from '@cnstra/types';

/**
 * The compartment this package owns in an activation's context store. A neuron
 * reads it to nest its own work under its task's span:
 *
 * ```ts
 * response: (p, axon, c) =>
 *     context.with(
 *         (c.activationContext?.[CNS_OTEL_CONTEXT] as TCNSOtelCompartment)?.context
 *             ?? context.active(),
 *         () => chargeCard(p)
 *     )
 * ```
 */
export const CNS_OTEL_CONTEXT = '@cnstra/persist-otel';

/**
 * What this package writes into `activationContext[CNS_OTEL_CONTEXT]`.
 *
 * Two fields for one reason: `context` is a live handle and stays in this
 * process, `traceparent` is a string and travels with the serialized frontier —
 * so a run resumed in another worker can continue the same trace.
 */
export type TCNSOtelCompartment = {
    /** In-process only: activate it to nest calls under this task's span. */
    context?: unknown;
    /** W3C `traceparent` for this task's span; survives a process boundary. */
    traceparent?: string;
};

/** Parse a W3C traceparent back into a remote span context, or undefined. */
const spanContextFrom = (traceparent: string): SpanContext | undefined => {
    const parts = traceparent.split('-');
    if (parts.length !== 4) return undefined;
    const [, traceId, spanId, flags] = parts;
    if (traceId.length !== 32 || spanId.length !== 16) return undefined;
    return {
        traceId,
        spanId,
        traceFlags: Number.parseInt(flags, 16) || 0,
        isRemote: true,
    };
};

/** W3C traceparent for a span, or undefined when it is not recording. */
const traceparentOf = (span: Span): string | undefined => {
    const sc = span.spanContext();
    if (!sc.traceId || !sc.spanId) return undefined;
    return `00-${sc.traceId}-${sc.spanId}-${(sc.traceFlags & 1 ? 1 : 0)
        .toString()
        .padStart(2, '0')}`;
};

/**
 * The slice of `CNS` this needs: the global response listener, and the network's
 * subscriber map — which is what lets the tree be built ahead of the work.
 */
export type TCNSTracingSource = {
    addResponseListener(
        listener: (response: TCNSStimulationResponse) => void | Promise<void>
    ): () => void;
    network: {
        getSubscribers(collateral: ICNSCollateral<unknown>): {
            neuron: TCNSNeuron<any>;
        }[];
    };
};

export type TCNSOtelTracingOptions = {
    /** The application's tracer. This package never creates a provider of its own. */
    tracer: Tracer;
    /**
     * Resolves a neuron to its registered name — normally
     * `neuron => registry.getNeuronName(neuron)` from `@cnstra/persist`.
     *
     * A neuron carries no name of its own, so without this every span is called
     * `neuron` rather than something made up.
     */
    neuronName?: (neuron: TCNSNeuron<any>) => string | undefined;
    /**
     * Resolves a collateral to its registered name — normally
     * `c => registry.getCollateralName(c)`. A collateral carries no name of its
     * own either, so without this the spans are named after their neurons alone.
     */
    collateralName?: (collateral: ICNSCollateral<unknown>) => string | undefined;
    /** Prefix for the attributes this sets. Defaults to `cnstra`. */
    attributePrefix?: string;
};

export type TCNSOtelTracingHandle = {
    /** Unsubscribes the listener and ends anything still open. */
    detach(): void;
};

/** One activation's span, and whether it has been closed already. */
type TActivationSpan = { span: Span; ended: boolean };

/** One live stimulation's spans. */
type TOpenRun = {
    root: Span;
    /**
     * neuron → the signal it will consume → that activation's span.
     *
     * The inner map is WEAK, and that is the whole memory behaviour of this
     * file. An entry cannot be deleted when its span closes — an activation
     * that emits an ARRAY of signals answers once per signal, and every one of
     * those children belongs under the same span, so deleting on close sent the
     * second child to the root. Kept in a strong map instead, the entry pinned
     * the signal object, its payload and the closed span for the whole run:
     * measured at 2.33 kB per hop, which is 18 MB at eight thousand hops and has
     * no bound at all on a cyclic run, against a few dozen kB for the same run
     * untraced.
     *
     * Weak, the entry survives exactly as long as the engine still holds the
     * signal — which is exactly as long as that activation can still answer.
     */
    byActivation: Map<object, WeakMap<object, TActivationSpan>>;
    /**
     * The spans not yet closed, which is what `detach()` needs to end.
     *
     * A weak map cannot be enumerated, and this is the reason it does not need
     * to be: only open spans are ever iterated, and there are at most as many of
     * those as the run has activations in flight — a concurrency, not a length.
     */
    open: Set<TActivationSpan>;
};

/**
 * Emits a run as spans, live from the engine, building the tree ahead of the work:
 * the root opens on the entry injection, and a neuron's children open the moment
 * it answers — the subscriber map already names every activation the emitted
 * signal will create, so a span exists before the work it describes.
 *
 * An activation is the pair `(neuron, the signal object it consumes)`, which is
 * exact because the engine hands every subscriber the same object.
 *
 * Needs no persistor and no `volume: 'full'`. It does not make a span created
 * inside a neuron a child of that neuron's — see `activationContext` for that.
 */
export const attachCNSOtelTracing = (
    cns: TCNSTracingSource,
    options: TCNSOtelTracingOptions
): TCNSOtelTracingHandle => {
    const { tracer } = options;
    const prefix = options.attributePrefix ?? 'cnstra';
    const runs = new Map<object, TOpenRun>();

    const nameOf = (neuron: TCNSNeuron<any>): string =>
        options.neuronName?.(neuron) ?? 'neuron';

    /** The collateral's registered name, or a stable fallback. */
    const describe = (signal: TCNSSignal<ICNSCollateral<unknown>>): string =>
        options.collateralName?.(signal.collateral) ?? 'collateral';

    /**
     * Open the spans of every activation `signal` is about to create, and write
     * each span into the activation it describes.
     *
     * `scheduled` is what the engine just built for this response. Preferring it
     * over resolving the subscribers again is what makes the pairing exact — the
     * span lands on the very task object that will run.
     */
    const openChildren = (
        run: TOpenRun,
        parent: Span,
        signal: TCNSSignal<ICNSCollateral<unknown>>,
        scheduled?: readonly TCNSNeuronActivationTask<any>[]
    ): void => {
        // Everything that does not vary per child is computed once. This runs per
        // EDGE of every hop, and the four values below were being rebuilt for
        // each one: the active context (an async-storage read), the parent
        // context (a fresh immutable Context allocation), the collateral's name
        // (a registry lookup), and a wrapper object per subscriber whose only
        // purpose was to give the two branches a common shape.
        const active = context.active();
        const childContext = trace.setSpan(active, parent);
        const attributes = {
            [`${prefix}.dendrite_collateral`]: describe(signal),
        };

        // Written as one loop over whichever source applies rather than a helper
        // called per child: a helper is a closure allocated on every call, and at
        // the common fan-out of one that costs more than the sharing saves.
        //
        // The engine's own tasks when it handed them over — that pairing is exact
        // — and the subscriber map only as the fallback.
        const tasks = scheduled?.length ? scheduled : undefined;
        const subscribers = tasks
            ? undefined
            : cns.network.getSubscribers(signal.collateral);
        const count = tasks ? tasks.length : subscribers!.length;

        for (let i = 0; i < count; i++) {
            const task = tasks ? tasks[i]! : undefined;
            const neuron = task ? task.neuron : subscribers![i]!.neuron;

            const span = tracer.startSpan(nameOf(neuron), { attributes }, childContext);
            if (task) {
                // The activation has not run yet — this is what lets a call made
                // inside the neuron nest under its own span.
                const store = (task.activationContext ??= {});
                const compartment: TCNSOtelCompartment = {
                    context: trace.setSpan(active, span),
                };
                const traceparent = traceparentOf(span);
                if (traceparent) compartment.traceparent = traceparent;
                store[CNS_OTEL_CONTEXT] = compartment;
            }
            let per = run.byActivation.get(neuron as object);
            if (!per)
                run.byActivation.set(neuron as object, (per = new WeakMap()));
            // Last writer wins on the same (neuron, signal) pair: the engine
            // creates one activation per subscriber per signal, so a repeat means
            // the same activation, not a second one.
            const held: TActivationSpan = { span, ended: false };
            per.set(signal as object, held);
            run.open.add(held);
        }
    };


    /**
     * Start recording a run we are seeing for the first time mid-flight.
     *
     * The resumed frontier task carries the previous attempt's `runTraceparent`,
     * so the new root joins that trace rather than starting a fresh one: Retry is
     * one more attempt of the same stimulation, and its trace is that
     * stimulation's trace. Without one — a run that began before this listener was
     * attached — it starts a trace of its own.
     */
    const openResumedRun = (
        key: object,
        response: TCNSStimulationResponse
    ): TOpenRun => {
        const carried = (
            runStore(response.stimulation)?.[CNS_OTEL_CONTEXT] as
                | TCNSOtelCompartment
                | undefined
        )?.traceparent;
        const remote = carried ? spanContextFrom(carried) : undefined;
        const parent: Context | undefined = remote
            ? trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(remote))
            : undefined;

        const root = tracer.startSpan(
            response.inputSignal ? describe(response.inputSignal) : 'stimulation',
            { attributes: { [`${prefix}.resumed`]: true } },
            parent
        );
        const run: TOpenRun = {
            root,
            byActivation: new Map(),
            open: new Set(),
        };
        runs.set(key, run);

        // The activation that revealed the run never had a span opened for it —
        // nothing in THIS process scheduled it; it came off the stored frontier.
        // Open one now against the engine's own measurement, so the neuron that
        // actually resumed the work is visible rather than only its children.
        if (response.neuron && response.inputSignal) {
            const resumed = tracer.startSpan(
                nameOf(response.neuron),
                {
                    ...(response.startedAt != null
                        ? { startTime: response.startedAt }
                        : {}),
                    attributes: {
                        [`${prefix}.dendrite_collateral`]: describe(
                            response.inputSignal
                        ),
                        [`${prefix}.resumed`]: true,
                    },
                },
                trace.setSpan(context.active(), root)
            );
            const per = new WeakMap<object, TActivationSpan>();
            const held: TActivationSpan = { span: resumed, ended: false };
            per.set(response.inputSignal as object, held);
            run.open.add(held);
            run.byActivation.set(response.neuron as object, per);
        }

        const close = () => {
            root.end();
            runs.delete(key);
        };
        void response.stimulation.waitUntilComplete().then(close, () => {
            root.setStatus({ code: SpanStatusCode.ERROR });
            close();
        });
        return run;
    };

    /**
     * The run's own context store — where a run's trace identity belongs.
     *
     * A Retry is the same stimulation, so the trace it rejoins is a fact about
     * the RUN, not about any one activation. Created on first write: the store is
     * a namespaced bag by design, and this package writes only its own key.
     */
    const runStore = (
        stimulation: TCNSStimulationResponse['stimulation']
    ): Record<string, unknown> | undefined => {
        const options = (
            stimulation as unknown as {
                options?: { stimulationContext?: Record<string, unknown> };
            }
        ).options;
        if (!options) return undefined;
        return (options.stimulationContext ??= {});
    };

    const off = cns.addResponseListener(response => {
        const key = response.stimulation as unknown as object;

        // The entry injection: no neuron, and it carries the signal the run starts
        // from. This is the first thing the engine emits, before any activation.
        if (!response.neuron) {
            if (runs.has(key)) return;
            const root = tracer.startSpan(
                response.outputSignal
                    ? describe(response.outputSignal)
                    : 'stimulation'
            );
            const run: TOpenRun = {
                root,
                byActivation: new Map(),
                open: new Set(),
            };
            runs.set(key, run);
            // Leave the run's trace identity in the run store, so a Retry — which
            // is this same stimulation, one attempt later, possibly in another
            // process — rejoins this trace instead of starting its own.
            const rootTraceparent = traceparentOf(root);
            if (rootTraceparent) {
                const store = runStore(response.stimulation);
                if (store)
                    store[CNS_OTEL_CONTEXT] = {
                        traceparent: rootTraceparent,
                    } satisfies TCNSOtelCompartment;
            }
            if (response.outputSignal)
                openChildren(
                    run,
                    root,
                    response.outputSignal,
                    response.scheduledActivationTasks
                );

            const close = () => {
                root.end();
                runs.delete(key);
            };
            void response.stimulation.waitUntilComplete().then(close, () => {
                root.setStatus({ code: SpanStatusCode.ERROR });
                close();
            });
            return;
        }

        // A Retry has no entry injection: `activate` puts the frontier straight
        // into the queue, so the first thing we ever see of a resumed run is an
        // activation answering. Open its root here, or the whole attempt goes
        // unrecorded — and rejoin the trace the previous attempt was part of,
        // because a Retry is the SAME stimulation, not a new one.
        const run = runs.get(key) ?? openResumedRun(key, response);
        if (!run) return;

        // Close the activation that just answered.
        const per = run.byActivation.get(response.neuron as object);
        const own = response.inputSignal
            ? per?.get(response.inputSignal as object)
            : undefined;
        if (own && !own.ended) {
            if (response.error) {
                own.span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                        response.error instanceof Error
                            ? response.error.message
                            : String(response.error),
                });
                own.span.recordException(response.error as Error);
            }
            // Closed with the engine's own measurement rather than wall time here:
            // an activation that emits an ARRAY of signals produces one response
            // per signal, and only the first of them is at the moment it settled.
            own.span.end(
                response.startedAt != null && response.duration != null
                    ? response.startedAt + response.duration
                    : undefined
            );
            own.ended = true;
            // Out of the open set the moment it closes: that set exists only so
            // `detach()` can end what is still running, and leaving a closed
            // span in it holds every span of the run — measured at 1.7 kB a hop
            // against 23 bytes when it is drained, which is most of what this
            // whole change is worth.
            run.open.delete(own);
        }
        // The entry is KEPT after closing. An activation emitting several signals
        // answers several times, and every one of those children belongs under the
        // same span — deleting it here sent the second one to the root instead.

        // …and open its children, which have not run yet.
        if (response.outputSignal && !response.error)
            openChildren(
                run,
                own?.span ?? run.root,
                response.outputSignal,
                response.scheduledActivationTasks
            );
    });

    return {
        detach() {
            off();
            // Anything still open would never be exported; end it rather than
            // leak a span the batch processor is holding.
            for (const run of runs.values()) {
                for (const held of run.open)
                    if (!held.ended) {
                        held.span.end();
                        held.ended = true;
                    }
                run.open.clear();
                run.root.end();
            }
            runs.clear();
        },
    };
};
