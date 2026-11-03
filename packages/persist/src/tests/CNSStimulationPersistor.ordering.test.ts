import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import type { TCNSStimulationResponse } from '@cnstra/types';
import { CNSDebouncedProgressRecordingStrategy } from '.././CNSDebouncedProgressRecordingStrategy';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSStimulationPersistor } from '.././CNSStimulationPersistor';
import type { ICNSProgressRecordingStrategy } from '.././interfaces/ICNSProgressRecordingStrategy';
import type { ICNSStimulationWriter } from '.././interfaces/ICNSStimulationRepository';

/**
 * What the store ends up holding after the run is over.
 *
 * The terminal write is the one that makes a run finished. Anything that lands
 * on the record AFTER it — a cadence timer still holding an earlier response's
 * closure, or a slower write that started earlier — puts `status: 'running'`,
 * `completedAt: null` back, and the run is stuck running forever with a live
 * Retry button. These tests assert on the LAST thing the store received, which
 * is the only thing an operator ever sees.
 */

const ENTRY = [{ collateralName: 'input', payload: { id: 1 } }];

/**
 * A writer that records the order in which writes LAND (not the order they were
 * issued), with a per-call delay — that is the order a real store applies them in.
 */
const recordingWriter = (delayForCall: (call: number) => number) => {
    const stimulationWrites: string[] = [];
    const attemptWrites: { status: string; completedAt: number | null }[] = [];
    let calls = 0;

    const writer: ICNSStimulationWriter = {
        async saveStimulation(stimulation) {
            const delay = delayForCall(++calls);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
            stimulationWrites.push(stimulation.status);
        },
        async saveAttempt(attempt) {
            attemptWrites.push({
                status: attempt.status,
                completedAt: attempt.completedAt,
            });
        },
        async appendTask() {},
        async getStimulation() {
            return undefined;
        },
    };

    return { writer, stimulationWrites, attemptWrites };
};

/** input → first → mid → second → out. Two hops, so a cadence timer gets armed. */
const buildFlow = () => {
    const input = cnsCollateral<{ id: number }>();
    const mid = cnsCollateral<{ id: number }>();
    const out = cnsCollateral<{ result: string }>();

    const first = cnsNeuron({ mid }).dendrite({
        collateral: input,
        response: (p, axon) => axon.mid.createSignal({ id: p!.id }),
    });
    const second = cnsNeuron({ out }).dendrite({
        collateral: mid,
        response: (p, axon) => axon.out.createSignal({ result: `ok-${p!.id}` }),
    });

    const cns = new CNS([first, second]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('first', first);
    registry.register('second', second);
    registry.registerCollateral('input', input);
    return { cns, registry, input };
};

/**
 * The shipped default strategy, with the count of responses it was asked to
 * schedule. Without that count a "no stale write" assertion could pass simply
 * because no timer was ever armed.
 */
class CountingDebouncedStrategy implements ICNSProgressRecordingStrategy {
    armed = 0;
    private readonly inner: CNSDebouncedProgressRecordingStrategy;

    constructor(debounceMs: number) {
        this.inner = new CNSDebouncedProgressRecordingStrategy({ debounceMs });
    }

    onResponse(response: TCNSStimulationResponse, flush: () => void): void {
        this.armed += 1;
        this.inner.onResponse(response, flush);
    }

    dispose(): void {
        this.inner.dispose();
    }
}

/** Flushes on every response — no coalescing, so two flushes are always in flight. */
class ImmediateStrategy implements ICNSProgressRecordingStrategy {
    onResponse(_response: TCNSStimulationResponse, flush: () => void): void {
        flush();
    }
    dispose(): void {}
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('write ordering', () => {
    it('a pending cadence timer cannot resurrect a finished run, with no dispose() at all', async () => {
        // 200ms debounce vs. two hops that settle in microtasks: the timer armed
        // by the first hop is unambiguously still pending when the run finishes.
        const strategy = new CountingDebouncedStrategy(200);
        const sink = recordingWriter(() => 0);
        const { cns, registry, input } = buildFlow();

        const persistor = new CNSStimulationPersistor({
            repository: sink.writer,
            registry,
            stimulationId: 'run-1',
            stimulationAttemptId: 'run-1#1',
            attemptNumber: 1,
            entry: ENTRY,
            strategy,
        });

        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: persistor.onResponse,
            })
            .waitUntilComplete();

        // Deliberately NO dispose(): the public API does not require it, and the
        // docs' own recipe disposes in a `finally` — i.e. after this point.
        await wait(500);

        // Not vacuous: a timer really was armed before the run ended.
        expect(strategy.armed).toBeGreaterThan(0);
        expect(sink.stimulationWrites).toContain('completed');
        expect(sink.stimulationWrites[sink.stimulationWrites.length - 1]).toBe(
            'completed'
        );
        expect(sink.attemptWrites[sink.attemptWrites.length - 1]).toEqual({
            status: 'completed',
            completedAt: expect.any(Number),
        });
    });

    it('keeps the terminal write last when the store settles writes out of order', async () => {
        // The first write is slow, everything after it is immediate — so an
        // unserialised terminal write overtakes the `running` one that preceded
        // it, and the `running` one lands last.
        const sink = recordingWriter(call => (call === 1 ? 60 : 0));
        const { cns, registry, input } = buildFlow();

        const persistor = new CNSStimulationPersistor({
            repository: sink.writer,
            registry,
            stimulationId: 'run-2',
            stimulationAttemptId: 'run-2#1',
            attemptNumber: 1,
            entry: ENTRY,
            strategy: new ImmediateStrategy(),
        });

        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: persistor.onResponse,
            })
            .waitUntilComplete();
        await wait(300);
        persistor.dispose();

        // Not vacuous: a `running` write really did overlap the terminal one.
        expect(sink.stimulationWrites).toContain('running');
        expect(sink.stimulationWrites[sink.stimulationWrites.length - 1]).toBe(
            'completed'
        );
        // …and it is the ONLY terminal write, i.e. nothing reopened the run.
        expect(
            sink.stimulationWrites.filter(s => s !== 'running')
        ).toEqual(['completed']);
        expect(sink.attemptWrites[sink.attemptWrites.length - 1]?.status).toBe(
            'completed'
        );
    });

    it('a failed write does not wedge the flushes that follow it', async () => {
        // Unlike the two above, this one also passes before the fix — there was
        // nothing to wedge. It guards the mechanism the fix introduces:
        // serialising flushes must not turn one store hiccup into a permanent
        // stall, so the terminal write still has to land.
        const written: string[] = [];
        let calls = 0;
        const { cns, registry, input } = buildFlow();

        const persistor = new CNSStimulationPersistor({
            repository: {
                async saveStimulation(stimulation) {
                    if (++calls === 1) throw new Error('store hiccup');
                    written.push(stimulation.status);
                },
                async saveAttempt() {},
                async appendTask() {},
                async getStimulation() {
                    return undefined;
                },
            },
            registry,
            stimulationId: 'run-3',
            stimulationAttemptId: 'run-3#1',
            attemptNumber: 1,
            entry: ENTRY,
            strategy: new ImmediateStrategy(),
        });

        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            await cns
                .stimulate(input.createSignal({ id: 1 }), {
                    onResponse: persistor.onResponse,
                })
                .waitUntilComplete();
            await wait(50);
        } finally {
            consoleError.mockRestore();
            persistor.dispose();
        }

        expect(written[written.length - 1]).toBe('completed');
    });
});
