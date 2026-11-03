import type { Meter } from '@opentelemetry/api';
import type {
    TCNSNeuron,
    TCNSStimulationDrain,
    TCNSStimulationResponse,
} from '@cnstra/types';

/** The slice of `CNS` this needs: the two global listener registrations. */
export type TCNSMetricsSource = {
    addResponseListener(
        listener: (response: TCNSStimulationResponse) => void | Promise<void>
    ): () => void;
    addDrainListener(listener: (drain: TCNSStimulationDrain) => void): () => void;
};

export type TCNSOtelMetricsOptions = {
    /** The application's meter. This package never creates a provider of its own. */
    meter: Meter;
    /**
     * Resolves a neuron to its registered name — normally
     * `neuron => registry.getNeuronName(neuron)` from `@cnstra/persist`.
     *
     * A neuron carries no name of its own, so without this the activation counter
     * simply goes untagged rather than reporting something made up.
     */
    neuronName?: (neuron: TCNSNeuron<any>) => string | undefined;
    /** Prefix for instrument names. Defaults to `cnstra`. */
    prefix?: string;
};

export type TCNSOtelMetricsHandle = {
    /** Unsubscribes both listeners. */
    detach(): void;
};

/**
 * Wires CNStra's two global listeners to OpenTelemetry instruments.
 *
 * This half needs no persistence: it observes the live engine, so it works on a
 * plain `new CNS(...)` — latency included, since the engine measures each
 * activation and reports it on the response.
 *
 * Queue depth is read from the **drain**, not from responses. Per
 * `TCNSStimulationDrain`, the counters on a drain are measured after the scheduler
 * loop exhausted, so they are a fact; on a response `pendingActivations` is still
 * a forecast.
 */
export const attachCNSOtelMetrics = (
    cns: TCNSMetricsSource,
    options: TCNSOtelMetricsOptions
): TCNSOtelMetricsHandle => {
    const prefix = options.prefix ?? 'cnstra';
    const { meter } = options;

    const activations = meter.createCounter(`${prefix}.activations`, {
        description: 'Neuron activations that produced a response',
    });
    // A histogram, not a counter: `response.hops` is the RUNNING number of times
    // this neuron has been entered in this run, so adding it to a counter sums
    // 1+2+3+… and reports a multiple of the truth (a neuron entered four times
    // contributed ten). What the number is good for is the distribution — how
    // close a neuron gets to its `maxNeuronHops` before a run ends — and that is
    // a histogram. Activations themselves are already counted above.
    const visits = meter.createHistogram(`${prefix}.neuron.visits`, {
        description:
            'How many times a neuron had been entered when it responded ' +
            '(present only when maxNeuronHops is set)',
    });
    const latency = meter.createHistogram(`${prefix}.activation.duration`, {
        description: 'How long a neuron activation took',
        unit: 'ms',
    });

    /**
     * What each live stimulation reported at its own last batch boundary, summed
     * on observation. Per-run rather than one shared slot: with concurrent runs a
     * single slot reports whichever drained last, not what the engine is holding.
     *
     * These are not stale readings. A run cannot make progress without announcing
     * a boundary — see `TCNSStimulationDrain` — so between drains its counters are
     * frozen by definition, and the last drained values are the current ones.
     */
    const live = new Map<
        object,
        { queue: number; pending: number; active: number }
    >();

    const sum = (read: (d: { queue: number; pending: number; active: number }) => number) => {
        let total = 0;
        for (const depth of live.values()) total += read(depth);
        return total;
    };

    const gauge = (name: string, read: () => number, description: string) => {
        const instrument = meter.createObservableGauge(`${prefix}.${name}`, {
            description,
        });
        instrument.addCallback(result => result.observe(read()));
        return instrument;
    };

    gauge(
        'queue_depth',
        () => sum(depth => depth.queue),
        'Activations all live stimulations still own'
    );
    gauge(
        'pending_activations',
        () => sum(depth => depth.pending),
        'Activations whose dendrite response has not been invoked'
    );
    gauge(
        'active_activations',
        () => sum(depth => depth.active),
        'Activations awaiting an unsettled promise'
    );

    const offResponse = cns.addResponseListener(response => {
        const name = response.neuron
            ? options.neuronName?.(response.neuron)
            : undefined;

        const attributes = {
            ...(name ? { [`${prefix}.neuron`]: name } : {}),
            [`${prefix}.outcome`]: response.error ? 'error' : 'ok',
        };
        activations.add(1, attributes);

        // Only real activations carry a duration; the entry injection and the
        // terminal abort signal do not, and recording a zero for them would drag
        // every percentile down.
        if (typeof response.duration === 'number')
            latency.record(response.duration, attributes);

        if (typeof response.hops === 'number')
            visits.record(response.hops, attributes);
    });

    const offDrain = cns.addDrainListener(drain => {
        const stimulation = drain.stimulation as object;
        const first = !live.has(stimulation);

        live.set(stimulation, {
            queue: drain.queueLength,
            pending: drain.pendingActivations,
            active: drain.activeActivations,
        });

        // Drop the run when it ends, on the run's own signal rather than on a
        // zero reading: an aborted run keeps its failed tasks outstanding and
        // would never reach zero, so counting down would leak it forever.
        // `waitUntilComplete` settles on every ending — completion, failure and
        // abort alike — which is exactly the lifecycle we need.
        if (first) {
            const forget = () => {
                live.delete(stimulation);
            };
            void drain.stimulation.waitUntilComplete().then(forget, forget);
        }
    });

    return {
        detach() {
            offResponse();
            offDrain();
            live.clear();
        },
    };
};
