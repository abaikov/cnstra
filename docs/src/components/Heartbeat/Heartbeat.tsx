import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import type { TCNSStimulationResponse } from '@cnstra/types';
import styles from './Heartbeat.module.css';

type TWave = 'p' | 'qrs' | 't';
type TWaveAt = { wave: TWave; at: number };

const BEAT_EVERY_MS = 1000;
const TRACE_MS = 5000;
const TRACE_WIDTH = 1000;
const BASELINE = 32;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const pacemakerFired = cnsCollateral<{ beat: number }>();
const atriaDepolarized = cnsCollateral<{ beat: number }>();
const ventriclesDepolarized = cnsCollateral<{ beat: number }>();
const ventriclesRepolarized = cnsCollateral<{ beat: number }>();

const sinoatrialNode = cnsNeuron({ atriaDepolarized }).dendrite({
    collateral: pacemakerFired,
    response: (payload, axon) => axon.atriaDepolarized.createSignal(payload),
});

const atrioventricularNode = cnsNeuron({ ventriclesDepolarized }).dendrite({
    collateral: atriaDepolarized,
    response: async (payload, axon) => {
        await wait(150);
        return axon.ventriclesDepolarized.createSignal(payload);
    },
});

const ventricles = cnsNeuron({ ventriclesRepolarized }).dendrite({
    collateral: ventriclesDepolarized,
    response: async (payload, axon) => {
        await wait(230);
        return axon.ventriclesRepolarized.createSignal(payload);
    },
});

const WAVE_OF = new Map<object, TWave>([
    [sinoatrialNode, 'p'],
    [atrioventricularNode, 'qrs'],
    [ventricles, 't'],
]);

const bump = (t: number, center: number, width: number, height: number) => Math.exp(-(((t - center) / width) ** 2)) * height;

const DEFLECTION_OF: Record<TWave, (ms: number) => number> = {
    p: ms => bump(ms, 40, 22, -5),
    qrs: ms => bump(ms, 6, 6, 4) + bump(ms, 20, 7, -24) + bump(ms, 36, 7, 9),
    t: ms => bump(ms, 70, 38, -8),
};

const WAVE_SPAN_MS = 200;

export default function Heartbeat({ onContraction }: { onContraction?: () => void }): ReactNode {
    const hostRef = useRef<HTMLDivElement>(null);
    const traceRef = useRef<SVGPathElement>(null);
    const headRef = useRef<HTMLElement>(null);
    const dotRef = useRef<HTMLElement>(null);
    const wavesRef = useRef<TWaveAt[]>([]);
    const onContractionRef = useRef(onContraction);
    onContractionRef.current = onContraction;
    const [beats, setBeats] = useState(0);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const cns = new CNS([sinoatrialNode, atrioventricularNode, ventricles]);
        let beat = 0;
        let pacing: ReturnType<typeof setTimeout> | undefined;
        let frame = 0;
        let inView = false;
        let running = false;

        const draw = () => {
            const now = performance.now();
            wavesRef.current = wavesRef.current.filter(wave => now - wave.at < TRACE_MS + WAVE_SPAN_MS);
            const points: string[] = [];
            let y = BASELINE;
            for (let x = 0; x <= TRACE_WIDTH; x += 2) {
                const at = now - TRACE_MS + (x / TRACE_WIDTH) * TRACE_MS;
                y = BASELINE;
                for (const wave of wavesRef.current) {
                    const since = at - wave.at;
                    if (since >= 0 && since <= WAVE_SPAN_MS) y += DEFLECTION_OF[wave.wave](since);
                }
                points.push(`${x},${y.toFixed(1)}`);
            }
            traceRef.current?.setAttribute('d', `M${points.join(' L')}`);
            headRef.current?.style.setProperty('top', `${((y / 48) * 100).toFixed(1)}%`);
            if (running) frame = requestAnimationFrame(draw);
        };

        const onResponse = (response: TCNSStimulationResponse) => {
            const wave = response.neuron ? WAVE_OF.get(response.neuron) : undefined;
            if (!wave || response.error) return;
            wavesRef.current.push({ wave, at: performance.now() });
            if (wave !== 'qrs') return;
            dotRef.current?.animate([{ opacity: 1, transform: 'scale(1.8)' }, { opacity: 0.35, transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
            onContractionRef.current?.();
        };

        const fire = () => {
            beat++;
            setBeats(beat);
            cns.stimulate(pacemakerFired.createSignal({ beat }), { onResponse });
            pacing = setTimeout(fire, BEAT_EVERY_MS + (Math.random() - 0.5) * 90);
        };

        const sync = () => {
            const shouldRun = inView && !document.hidden;
            if (shouldRun === running) return;
            running = shouldRun;
            if (running) {
                fire();
                frame = requestAnimationFrame(draw);
            } else {
                clearTimeout(pacing);
                cancelAnimationFrame(frame);
            }
        };

        if (reducedMotion) {
            const now = performance.now();
            wavesRef.current = [
                { wave: 'p', at: now - 2600 },
                { wave: 'qrs', at: now - 2450 },
                { wave: 't', at: now - 2220 },
            ];
            draw();
            return undefined;
        }

        const observer = new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            sync();
        });
        observer.observe(host);
        document.addEventListener('visibilitychange', sync);
        return () => {
            observer.disconnect();
            document.removeEventListener('visibilitychange', sync);
            inView = false;
            sync();
        };
    }, []);

    return (
        <div className={styles.heartbeat} ref={hostRef}>
            <span className={styles.route}>
                <i ref={dotRef} className={styles.dot} /> sinoatrialNode → atrioventricularNode → ventricles
            </span>
            <div className={styles.monitor}>
                <svg className={styles.trace} viewBox={`0 0 ${TRACE_WIDTH} 48`} preserveAspectRatio="none" aria-hidden="true">
                    <path ref={traceRef} className={styles.line} />
                </svg>
                <i ref={headRef} className={styles.head} />
            </div>
            <span className={styles.count}>
                stimulation #{String(beats).padStart(4, '0')}
            </span>
        </div>
    );
}
