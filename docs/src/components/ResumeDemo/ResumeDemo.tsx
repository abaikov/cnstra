import React, { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import type { TCNSNeuronActivationTask, TCNSStimulationResponse } from '@cnstra/types';
import OrderGraph, { IDLE_ORDER_NODES } from '../OrderGraph/OrderGraph';
import type { TOrderNodeId, TOrderNodes } from '../OrderGraph/OrderGraph';
import styles from './ResumeDemo.module.css';

type TPhase = 'idle' | 'running' | 'crashed' | 'resuming' | 'completed';
type TLogTone = 'command' | 'ok' | 'bad' | 'note';
type TLogLine = { tone: TLogTone; text: string };
type TOrder = { orderId: number };

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const executions: Record<TOrderNodeId, number> = { entry: 0, inventory: 0, payment: 0, mailer: 0, shipping: 0 };
let isPaymentProviderDown = false;

const orderPlaced = cnsCollateral<TOrder>();
const stockReserved = cnsCollateral<TOrder>();
const paymentCaptured = cnsCollateral<TOrder>();
const receiptSent = cnsCollateral<TOrder>();
const orderShipped = cnsCollateral<TOrder>();

const inventory = cnsNeuron({ stockReserved }).dendrite({
    collateral: orderPlaced,
    response: async (order, axon) => {
        executions.inventory++;
        await wait(420);
        return axon.stockReserved.createSignal(order);
    },
});

const payment = cnsNeuron({ paymentCaptured }).dendrite({
    collateral: stockReserved,
    response: async (order, axon) => {
        executions.payment++;
        await wait(560);
        if (isPaymentProviderDown) throw new Error('payment provider down');
        return axon.paymentCaptured.createSignal(order);
    },
});

const mailer = cnsNeuron({ receiptSent }).dendrite({
    collateral: paymentCaptured,
    response: async (order, axon) => {
        executions.mailer++;
        await wait(320);
        return axon.receiptSent.createSignal(order);
    },
});

const shipping = cnsNeuron({ orderShipped }).dendrite({
    collateral: paymentCaptured,
    response: async (order, axon) => {
        executions.shipping++;
        await wait(520);
        return axon.orderShipped.createSignal(order);
    },
});

const NODE_OF = new Map<object, TOrderNodeId>([
    [inventory, 'inventory'],
    [payment, 'payment'],
    [mailer, 'mailer'],
    [shipping, 'shipping'],
]);

const COLLATERAL_NAME_OF = new Map<object, string>([
    [orderPlaced, 'orderPlaced'],
    [stockReserved, 'stockReserved'],
    [paymentCaptured, 'paymentCaptured'],
]);

const describeTask = (task: TCNSNeuronActivationTask) =>
    `${NODE_OF.get(task.neuron)} ← ${COLLATERAL_NAME_OF.get(task.dendriteCollateral)} ${JSON.stringify(task.input?.payload)}`;

const badgesOf = (nodes: TOrderNodes) => {
    const badges: Partial<Record<TOrderNodeId, string>> = {};
    for (const id of Object.keys(executions) as TOrderNodeId[]) {
        if (executions[id] > 0 && nodes[id] !== 'idle') badges[id] = `ran ${executions[id]}×`;
    }
    return badges;
};

export default function ResumeDemo(): ReactNode {
    const [phase, setPhase] = useState<TPhase>('idle');
    const [nodes, setNodes] = useState<TOrderNodes>(IDLE_ORDER_NODES);
    const [log, setLog] = useState<TLogLine[]>([]);
    const cnsRef = useRef<CNS<any, any> | null>(null);
    const frontierRef = useRef<TCNSNeuronActivationTask[]>([]);
    const orderIdRef = useRef(1041);

    const write = useCallback((tone: TLogTone, text: string) => setLog(current => [...current, { tone, text }]), []);

    const onResponse = useCallback(
        (response: TCNSStimulationResponse) => {
            setNodes(current => {
                const next = { ...current };
                for (const task of response.scheduledActivationTasks ?? []) {
                    const scheduled = NODE_OF.get(task.neuron);
                    if (scheduled) next[scheduled] = 'running';
                }
                const finished = response.neuron ? NODE_OF.get(response.neuron) : undefined;
                if (finished) next[finished] = response.error ? 'failed' : 'done';
                return next;
            });
            const finished = response.neuron ? NODE_OF.get(response.neuron) : undefined;
            if (finished === undefined) return;
            if (response.error) write('bad', `  ${finished.padEnd(10)} ✗ ${(response.error as Error).message}`);
            else write('ok', `  ${finished.padEnd(10)} ✓`);
        },
        [write]
    );

    const runAndCrash = useCallback(() => {
        if (!cnsRef.current) cnsRef.current = new CNS([inventory, payment, mailer, shipping]);
        for (const id of Object.keys(executions) as TOrderNodeId[]) executions[id] = 0;
        isPaymentProviderDown = true;
        const orderId = ++orderIdRef.current;
        setPhase('running');
        setNodes({ ...IDLE_ORDER_NODES, entry: 'done' });
        setLog([{ tone: 'command', text: `> cns.stimulate(orderPlaced.createSignal({ orderId: ${orderId} }))` }]);
        const stimulation = cnsRef.current.stimulate(orderPlaced.createSignal({ orderId }), { onResponse });
        stimulation.waitUntilComplete().catch(() => {
            frontierRef.current = stimulation.getOutstandingTasks();
            write('note', '> stimulation.getOutstandingTasks()');
            for (const task of frontierRef.current) write('note', `  [ ${describeTask(task)} ]`);
            setPhase('crashed');
        });
    }, [onResponse, write]);

    const resume = useCallback(() => {
        if (!cnsRef.current) return;
        isPaymentProviderDown = false;
        setPhase('resuming');
        setNodes(current => ({ ...current, payment: 'running' }));
        write('command', '> cns.activate(frontier)');
        cnsRef.current
            .activate(frontierRef.current, { onResponse })
            .waitUntilComplete()
            .then(() => {
                write('note', `  inventory ran ${executions.inventory}× — the stock was reserved once`);
                setPhase('completed');
            });
    }, [onResponse, write]);

    const isBusy = phase === 'running' || phase === 'resuming';

    return (
        <div className={styles.monitor}>
            <div className={styles.header}>
                <span className={styles.brand}>cnstra · resume</span>
                <span className={styles.phase} data-phase={phase}>
                    {phase}
                </span>
            </div>
            <div className={styles.body}>
                <div className={styles.graphPane}>
                    <div className={styles.paneTitle}>topology</div>
                    <OrderGraph nodes={nodes} badges={badgesOf(nodes)} />
                    <div className={styles.actions}>
                        {phase === 'crashed' ? (
                            <button type="button" className={styles.action} onClick={resume}>
                                resume from the frontier
                            </button>
                        ) : (
                            <button
                                type="button"
                                className={`${styles.action} ${styles.actionDanger}`}
                                onClick={runAndCrash}
                                disabled={isBusy}
                            >
                                run, fail it at payment
                            </button>
                        )}
                    </div>
                </div>
                <div className={styles.runsPane}>
                    <div className={styles.paneTitle}>console</div>
                    <ol className={styles.log}>
                        {log.map((line, index) => (
                            <li key={index} className={styles[line.tone]}>
                                {line.text}
                            </li>
                        ))}
                        {log.length === 0 && <li className={styles.note}>press the red button</li>}
                    </ol>
                </div>
            </div>
        </div>
    );
}
