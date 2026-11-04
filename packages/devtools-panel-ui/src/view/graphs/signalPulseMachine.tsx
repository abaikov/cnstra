import { composeExoMachine, createExoMachine, withExoEffects, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { FIRST_PAGE } from '../../constants/FIRST_PAGE';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const TRACE_WIDTH = 200;
const TRACE_HEIGHT = 30;
const TRACE_VIEW_BOX = `0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`;
const TRACE_HEAD_X = TRACE_WIDTH - 1;
const BEAT_LENGTH = 46;
const BEATS_PER_ARRIVAL = 4;
const STEPS_PER_FRAME = 2;

const signalPulseSchema = exoJsx<{ trace: TExoAttrPort; headY: TExoAttrPort }>($ => (
    <svg class="exp-pulse" viewBox={TRACE_VIEW_BOX} preserveAspectRatio="none">
        <polyline class="exp-pulse-trace" points={$.trace} />
        <circle class="exp-pulse-head" r="2.4" cx={TRACE_HEAD_X} cy={$.headY} />
    </svg>
));
const SignalPulsePorts = signalPulseSchema.ports;

type TCNSSignalPulseState = {
    trace: number[];
    queuedBeats: number;
    beatAt: number;
    lastTotal: number | undefined;
};

const signalPulseBase = createExoMachine(signalPulseSchema, {
    createInitialState: (_c: TCNSDevToolsNode): TCNSSignalPulseState => ({
        trace: new Array<number>(TRACE_WIDTH).fill(TRACE_HEIGHT / 2),
        queuedBeats: 0,
        beatAt: -1,
        lastTotal: undefined,
    }),
});

const gaussianOf = (phase: number, center: number, width: number, amplitude: number): number => amplitude * Math.exp(-((phase - center) ** 2) / (2 * width * width));
const heartbeatWaveOf = (phase: number): number =>
    gaussianOf(phase, 0.16, 0.026, 0.16) + gaussianOf(phase, 0.32, 0.01, -0.12) + gaussianOf(phase, 0.35, 0.009, 1.0) + gaussianOf(phase, 0.385, 0.011, -0.32) + gaussianOf(phase, 0.6, 0.055, 0.3);

const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function queueBeats(c: TExoMachineNodeOf<typeof signalPulseBase>, count: number): void {
    c.state.queuedBeats += Math.min(count, BEATS_PER_ARRIVAL);
}

function nextSampleOf(state: TCNSSignalPulseState): number {
    if (state.beatAt < 0 && state.queuedBeats > 0) {
        state.queuedBeats--;
        state.beatAt = 0;
    }
    if (state.beatAt < 0) return TRACE_HEIGHT / 2 + (Math.random() - 0.5) * 1.2;
    const sample = TRACE_HEIGHT / 2 - heartbeatWaveOf(state.beatAt / BEAT_LENGTH) * (TRACE_HEIGHT / 2 - 2);
    state.beatAt = state.beatAt + 1 >= BEAT_LENGTH ? -1 : state.beatAt + 1;
    return sample;
}

function showTrace(c: TExoMachineNodeOf<typeof signalPulseBase>): void {
    const { trace } = c.state;
    c.attr(SignalPulsePorts.trace, trace.map((sample, x) => `${x},${sample.toFixed(1)}`).join(' '));
    c.attr(SignalPulsePorts.headY, trace[TRACE_HEAD_X].toFixed(1));
}

export const signalPulseMachine = composeExoMachine(
    signalPulseBase,
    m => withExoTransitions(m, {
        countStimulations: (c, total: number | undefined) => {
            if (total === undefined) return;
            const { lastTotal } = c.state;
            c.state.lastTotal = total;
            if (lastTotal !== undefined && total > lastTotal) queueBeats(c, total - lastTotal);
        },
        advance: (c, steps: number) => {
            const { state } = c;
            for (let step = 0; step < steps; step++) {
                state.trace.shift();
                state.trace.push(nextSampleOf(state));
            }
            showTrace(c);
        },
    }),
    m => {
        const { countStimulations } = m.transitions;
        return withOIMEffects(m, effect => {
            effect(c => countStimulations(c, CNSExplorerReads.stimulationRowsOf(c, CNSExplorerReads.queryOf(c), FIRST_PAGE).total));
        });
    },
    m => {
        const { advance } = m.transitions;
        return withExoEffects(m, effect => {
            effect(c => {
                if (prefersReducedMotion()) {
                    queueBeats(c, 1);
                    advance(c, BEAT_LENGTH + 40);
                    return null;
                }
                let frame = requestAnimationFrame(function tick() {
                    advance(c, STEPS_PER_FRAME);
                    frame = requestAnimationFrame(tick);
                });
                return () => cancelAnimationFrame(frame);
            });
        });
    }
);
