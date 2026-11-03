import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import type { TCNSStimulationResponse } from '@cnstra/types';
import OrderGraph, { IDLE_ORDER_NODES } from '../OrderGraph/OrderGraph';
import type { TOrderNodeId, TOrderNodes } from '../OrderGraph/OrderGraph';
import styles from './RunMonitor.module.css';

type TRunStatus = 'running' | 'completed' | 'failed';

type TRun = {
    id: number;
    declined: boolean;
    status: TRunStatus;
    hops: number;
    startedAt: number;
    durationMs?: number;
    nodes: TOrderNodes;
};

const RUNS_SHOWN = 6;
const AUTO_RUN_EVERY_MS = 3200;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const orderPlaced = cnsCollateral<{ orderId: number; declined: boolean }>();
const stockReserved = cnsCollateral<{ orderId: number; declined: boolean }>();
const paymentCaptured = cnsCollateral<{ orderId: number }>();
const receiptSent = cnsCollateral<{ orderId: number }>();
const orderShipped = cnsCollateral<{ orderId: number }>();

const inventory = cnsNeuron({ stockReserved }).dendrite({
    collateral: orderPlaced,
    response: async (payload, axon) => {
        await wait(380);
        return axon.stockReserved.createSignal(payload);
    },
});

const payment = cnsNeuron({ paymentCaptured }).dendrite({
    collateral: stockReserved,
    response: async (payload, axon) => {
        await wait(520);
        if (payload.declined) throw new Error('card declined');
        return axon.paymentCaptured.createSignal({ orderId: payload.orderId });
    },
});

const mailer = cnsNeuron({ receiptSent }).dendrite({
    collateral: paymentCaptured,
    response: async (payload, axon) => {
        await wait(300);
        return axon.receiptSent.createSignal(payload);
    },
});

const shipping = cnsNeuron({ orderShipped }).dendrite({
    collateral: paymentCaptured,
    response: async (payload, axon) => {
        await wait(640);
        return axon.orderShipped.createSignal(payload);
    },
});

const NODE_OF = new Map<object, TOrderNodeId>([
    [inventory, 'inventory'],
    [payment, 'payment'],
    [mailer, 'mailer'],
    [shipping, 'shipping'],
]);

const formatDuration = (ms: number) =>
    ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;

function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduced(query.matches);
        const onChange = () => setReduced(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

function Pulse({ beats, reducedMotion }: { beats: { at: number; failed: boolean }[]; reducedMotion: boolean }): ReactNode {
    const pathRef = useRef<SVGPathElement>(null);
    const beatsRef = useRef(beats);
    beatsRef.current = beats;

    useEffect(() => {
        const width = 320;
        const baseline = 24;
        const windowMs = 6000;
        const shape = (t: number) =>
            Math.exp(-(((t - 0.35) / 0.03) ** 2)) * -16 +
            Math.exp(-(((t - 0.42) / 0.035) ** 2)) * 6 +
            Math.exp(-(((t - 0.7) / 0.08) ** 2)) * -3;
        let frame = 0;
        const draw = () => {
            const now = performance.now();
            const points: string[] = [];
            for (let x = 0; x <= width; x += 2) {
                const at = now - windowMs + (x / width) * windowMs;
                let y = baseline;
                for (const beat of beatsRef.current) {
                    const t = (at - beat.at) / 700;
                    if (t >= 0 && t <= 1) y += shape(t);
                }
                points.push(`${x},${y.toFixed(1)}`);
            }
            pathRef.current?.setAttribute('d', `M${points.join(' L')}`);
            if (!reducedMotion) frame = requestAnimationFrame(draw);
        };
        draw();
        return () => cancelAnimationFrame(frame);
    }, [reducedMotion, reducedMotion && beats]);

    const lastFailed = beats.length > 0 && beats[beats.length - 1].failed;
    return (
        <svg className={styles.pulse} viewBox="0 0 320 48" preserveAspectRatio="none" aria-hidden="true">
            <path ref={pathRef} className={lastFailed ? styles.pulseFailed : styles.pulseLine} />
        </svg>
    );
}

export default function RunMonitor(): ReactNode {
    const [runs, setRuns] = useState<TRun[]>([]);
    const [beats, setBeats] = useState<{ at: number; failed: boolean }[]>([]);
    const [totals, setTotals] = useState({ completed: 0, failed: 0 });
    const cnsRef = useRef<CNS<any, any> | null>(null);
    const nextIdRef = useRef(1);
    const hostRef = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();

    const patchRun = useCallback((id: number, patch: (run: TRun) => TRun) => {
        setRuns(current => current.map(run => (run.id === id ? patch(run) : run)));
    }, []);

    const placeOrder = useCallback(
        (declined: boolean) => {
            if (!cnsRef.current) cnsRef.current = new CNS([inventory, payment, mailer, shipping]);
            const id = nextIdRef.current++;
            const startedAt = performance.now();
            setRuns(current =>
                [
                    { id, declined, status: 'running' as const, hops: 0, startedAt, nodes: { ...IDLE_ORDER_NODES, entry: 'done' as const } },
                    ...current,
                ].slice(0, RUNS_SHOWN)
            );
            setBeats(current => [...current.filter(beat => startedAt - beat.at < 7000), { at: startedAt, failed: false }]);

            const onResponse = (response: TCNSStimulationResponse) => {
                patchRun(id, run => {
                    const nodes = { ...run.nodes };
                    for (const task of response.scheduledActivationTasks ?? []) {
                        const scheduled = NODE_OF.get(task.neuron);
                        if (scheduled) nodes[scheduled] = 'running';
                    }
                    const finished = response.neuron ? NODE_OF.get(response.neuron) : undefined;
                    if (finished) nodes[finished] = response.error ? 'failed' : 'done';
                    return { ...run, nodes, hops: run.hops + (finished ? 1 : 0) };
                });
            };

            const stimulation = cnsRef.current.stimulate(orderPlaced.createSignal({ orderId: id, declined }), { onResponse });
            stimulation.waitUntilComplete().then(
                () => {
                    patchRun(id, run => ({ ...run, status: 'completed', durationMs: performance.now() - startedAt }));
                    setTotals(current => ({ ...current, completed: current.completed + 1 }));
                },
                () => {
                    const failedAt = performance.now();
                    patchRun(id, run => ({ ...run, status: 'failed', durationMs: failedAt - startedAt }));
                    setTotals(current => ({ ...current, failed: current.failed + 1 }));
                    setBeats(current => [...current, { at: failedAt, failed: true }]);
                }
            );
        },
        [patchRun]
    );

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let timer: ReturnType<typeof setInterval> | undefined;
        let tick = 0;
        const start = () => {
            if (timer) return;
            placeOrder(false);
            timer = setInterval(() => placeOrder(++tick % 4 === 3), AUTO_RUN_EVERY_MS);
        };
        const stop = () => {
            if (timer) clearInterval(timer);
            timer = undefined;
        };
        const observer = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { threshold: 0.25 });
        observer.observe(host);
        return () => {
            observer.disconnect();
            stop();
        };
    }, [placeOrder]);

    const latest = runs[0];

    return (
        <div className={styles.monitor} ref={hostRef}>
            <div className={styles.header}>
                <span className={styles.brand}>cnstra · explorer</span>
                <span className={styles.live}>
                    <i /> live
                </span>
                <Pulse beats={beats} reducedMotion={reducedMotion} />
                <span className={styles.counter}>
                    <b className={styles.ok}>{totals.completed}</b> completed
                </span>
                <span className={styles.counter}>
                    <b className={styles.bad}>{totals.failed}</b> failed
                </span>
            </div>
            <div className={styles.body}>
                <div className={styles.graphPane}>
                    <div className={styles.paneTitle}>
                        topology
                        {latest && <span className={styles.paneHint}>run #{String(latest.id).padStart(4, '0')}</span>}
                    </div>
                    <OrderGraph nodes={latest ? latest.nodes : IDLE_ORDER_NODES} />
                    <div className={styles.actions}>
                        <button type="button" className={styles.action} onClick={() => placeOrder(false)}>
                            place order
                        </button>
                        <button type="button" className={`${styles.action} ${styles.actionDanger}`} onClick={() => placeOrder(true)}>
                            decline a card
                        </button>
                    </div>
                </div>
                <div className={styles.runsPane}>
                    <div className={styles.paneTitle}>stimulations</div>
                    <ol className={styles.runs}>
                        {runs.map(run => (
                            <li key={run.id} className={styles.run}>
                                <span className={styles.runId}>#{String(run.id).padStart(4, '0')}</span>
                                <span className={styles[`status_${run.status}`]}>{run.status}</span>
                                <span className={styles.runHops}>{run.hops} hops</span>
                                <span className={styles.runTime}>{run.durationMs === undefined ? '…' : formatDuration(run.durationMs)}</span>
                            </li>
                        ))}
                        {runs.length === 0 && <li className={styles.empty}>waiting for the first stimulation…</li>}
                    </ol>
                </div>
            </div>
        </div>
    );
}
