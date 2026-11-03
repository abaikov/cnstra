import type { Counter, Meter, ObservableGauge } from '@opentelemetry/api';
import type {
    TCNSStimulationDrain,
    TCNSStimulationResponse,
} from '@cnstra/types';

import { attachCNSOtelMetrics } from '.././attachCNSOtelMetrics';

type TRecordedAdd = { value: number; attributes?: Record<string, unknown> };

/** A CNS stand-in exposing only the two listener registrations we use. */
const fakeCns = () => {
    const responses: Array<(r: TCNSStimulationResponse) => void> = [];
    const drains: Array<(d: TCNSStimulationDrain) => void> = [];
    let unsubscribed = 0;

    return {
        unsubscribedCount: () => unsubscribed,
        emitResponse: (r: Partial<TCNSStimulationResponse>) =>
            responses.forEach(listener =>
                listener(r as TCNSStimulationResponse)
            ),
        emitDrain: (d: Partial<TCNSStimulationDrain>) =>
            drains.forEach(listener => listener(d as TCNSStimulationDrain)),
        /** A stimulation stand-in whose completion we drive by hand. */
        stimulation: () => {
            let settle!: () => void;
            const done = new Promise<void>(resolve => (settle = resolve));
            return { complete: settle, stimulation: { waitUntilComplete: () => done } };
        },
        cns: {
            addResponseListener(listener: (r: TCNSStimulationResponse) => void) {
                responses.push(listener);
                return () => {
                    unsubscribed++;
                };
            },
            addDrainListener(listener: (d: TCNSStimulationDrain) => void) {
                drains.push(listener);
                return () => {
                    unsubscribed++;
                };
            },
        },
    };
};

const fakeMeter = () => {
    const counters = new Map<string, TRecordedAdd[]>();
    const callbacks = new Map<
        string,
        (result: { observe: (value: number) => void }) => void
    >();

    const meter = {
        createCounter(name: string) {
            counters.set(name, []);
            return {
                add(value: number, attributes?: Record<string, unknown>) {
                    counters.get(name)!.push({ value, attributes });
                },
            } as unknown as Counter;
        },
        createHistogram(name: string) {
            counters.set(name, []);
            return {
                record(value: number, attributes?: Record<string, unknown>) {
                    counters.get(name)!.push({ value, attributes });
                },
            } as unknown as Counter;
        },
        createObservableGauge(name: string) {
            return {
                addCallback(
                    callback: (result: {
                        observe: (value: number) => void;
                    }) => void
                ) {
                    callbacks.set(name, callback);
                },
                removeCallback() {
                    callbacks.delete(name);
                },
            } as unknown as ObservableGauge;
        },
    } as unknown as Meter;

    /** Run a gauge's callback the way the SDK would, and return what it observed. */
    const observe = (name: string) => {
        let observed: number | undefined;
        callbacks.get(name)?.({ observe: value => (observed = value) });
        return observed;
    };

    return { meter, counters, observe, gaugeCount: () => callbacks.size };
};

describe('attachCNSOtelMetrics', () => {
    it('counts one activation per response, tagged with the neuron', () => {
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter, neuronName: () => 'validate' });
        emitResponse({ queueLength: 2, neuron: {} as never });

        expect(counters.get('cnstra.activations')).toEqual([
            {
                value: 1,
                attributes: {
                    'cnstra.neuron': 'validate',
                    'cnstra.outcome': 'ok',
                },
            },
        ]);
    });

    it('separates failed activations by outcome rather than a second counter', () => {
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter, neuronName: () => 'charge' });
        emitResponse({ error: new Error('card declined'), neuron: {} as never });

        expect(counters.get('cnstra.activations')![0].attributes).toEqual({
            'cnstra.neuron': 'charge',
            'cnstra.outcome': 'error',
        });
    });

    it('omits the neuron attribute rather than inventing a name', () => {
        // A neuron carries no name of its own — names live in the persist
        // registry — so without a resolver there is nothing truthful to report.
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter });
        emitResponse({});

        expect(counters.get('cnstra.activations')![0].attributes).toEqual({
            'cnstra.outcome': 'ok',
        });
    });

    it('reads queue depth from the drain, where the counter is a fact', () => {
        const { cns, emitDrain, stimulation } = fakeCns();
        const { meter, observe } = fakeMeter();
        const run = stimulation();

        attachCNSOtelMetrics(cns as never, { meter });
        emitDrain({
            stimulation: run.stimulation as never,
            queueLength: 5,
            pendingActivations: 4,
            activeActivations: 1,
        });

        expect(observe('cnstra.queue_depth')).toBe(5);
        expect(observe('cnstra.pending_activations')).toBe(4);
        expect(observe('cnstra.active_activations')).toBe(1);
    });

    it('sums concurrent stimulations instead of reporting whichever drained last', () => {
        const { cns, emitDrain, stimulation } = fakeCns();
        const { meter, observe } = fakeMeter();
        const first = stimulation();
        const second = stimulation();

        attachCNSOtelMetrics(cns as never, { meter });
        emitDrain({
            stimulation: first.stimulation as never,
            queueLength: 5,
            pendingActivations: 4,
            activeActivations: 1,
        });
        emitDrain({
            stimulation: second.stimulation as never,
            queueLength: 3,
            pendingActivations: 3,
            activeActivations: 0,
        });

        expect(observe('cnstra.queue_depth')).toBe(8);
        expect(observe('cnstra.pending_activations')).toBe(7);
        expect(observe('cnstra.active_activations')).toBe(1);
    });

    it('keeps a run counted while it is blocked between drains', () => {
        const { cns, emitDrain, stimulation } = fakeCns();
        const { meter, observe } = fakeMeter();
        const run = stimulation();

        attachCNSOtelMetrics(cns as never, { meter });
        emitDrain({
            stimulation: run.stimulation as never,
            queueLength: 2,
            pendingActivations: 2,
            activeActivations: 0,
        });

        // Observed repeatedly with no further drain: a run cannot progress
        // without announcing a boundary, so the last reading is still current.
        expect(observe('cnstra.queue_depth')).toBe(2);
        expect(observe('cnstra.queue_depth')).toBe(2);
    });

    it('drops a run when it finishes, on the run own completion signal', async () => {
        const { cns, emitDrain, stimulation } = fakeCns();
        const { meter, observe } = fakeMeter();
        const finished = stimulation();
        const stillGoing = stimulation();

        attachCNSOtelMetrics(cns as never, { meter });
        emitDrain({
            stimulation: finished.stimulation as never,
            queueLength: 5,
            pendingActivations: 5,
            activeActivations: 0,
        });
        emitDrain({
            stimulation: stillGoing.stimulation as never,
            queueLength: 2,
            pendingActivations: 2,
            activeActivations: 0,
        });

        finished.complete();
        await Promise.resolve();
        await Promise.resolve();

        expect(observe('cnstra.queue_depth')).toBe(2);
    });

    it('drops an aborted run too, which never reaches a zero reading', async () => {
        const { cns, emitDrain, stimulation } = fakeCns();
        const { meter, observe } = fakeMeter();

        let reject!: (error: Error) => void;
        const done = new Promise<void>((_, r) => (reject = r));
        const aborted = { waitUntilComplete: () => done };

        attachCNSOtelMetrics(cns as never, { meter });
        // An aborted run keeps its failed tasks outstanding: the drain reports a
        // non-zero depth and no further drain ever comes.
        emitDrain({
            stimulation: aborted as never,
            queueLength: 4,
            pendingActivations: 4,
            activeActivations: 0,
        });
        expect(observe('cnstra.queue_depth')).toBe(4);

        reject(new Error('aborted'));
        await Promise.resolve();
        await Promise.resolve();

        expect(observe('cnstra.queue_depth')).toBe(0);
    });

    it('reports zero depth before any run has drained', () => {
        const { cns } = fakeCns();
        const { meter, observe } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter });

        expect(observe('cnstra.queue_depth')).toBe(0);
    });

    it('records the visit count only when the engine reports one', () => {
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter });
        emitResponse({});
        emitResponse({ hops: 3 });

        // Present only when `maxNeuronHops` is set on the run.
        expect(counters.get('cnstra.neuron.visits')).toEqual([
            { value: 3, attributes: { 'cnstra.outcome': 'ok' } },
        ]);
    });

    it('does not accumulate the running visit count into a total', () => {
        // `response.hops` is a RUNNING count for that neuron. Summed as counter
        // increments, a neuron entered four times reported ten hops. A histogram
        // keeps each reading as a reading.
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter });
        for (const hops of [1, 2, 3, 4]) emitResponse({ hops });

        const recorded = counters.get('cnstra.neuron.visits') ?? [];
        expect(recorded.map(r => r.value)).toEqual([1, 2, 3, 4]);
    });

    it('records activation latency, tagged the same way as the counter', () => {
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter, neuronName: () => 'charge' });
        emitResponse({ neuron: {} as never, duration: 37 });

        expect(counters.get('cnstra.activation.duration')).toEqual([
            {
                value: 37,
                attributes: {
                    'cnstra.neuron': 'charge',
                    'cnstra.outcome': 'ok',
                },
            },
        ]);
    });

    it('records no latency for a response that is not an activation', () => {
        // The entry injection and the terminal abort signal carry no duration;
        // recording a zero for them would drag every percentile down.
        const { cns, emitResponse } = fakeCns();
        const { meter, counters } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter });
        emitResponse({});

        expect(counters.get('cnstra.activation.duration')).toEqual([]);
    });

    it('detaches both listeners when the returned handle is disposed', () => {
        const { cns, unsubscribedCount } = fakeCns();
        const { meter } = fakeMeter();

        attachCNSOtelMetrics(cns as never, { meter }).detach();

        expect(unsubscribedCount()).toBe(2);
    });
});
