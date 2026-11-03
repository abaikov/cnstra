import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSDevTools } from '@cnstra/devtools';
import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository, CNSPersistOptionsRegistryFactory } from '@cnstra/persist';

export type TDevToolsDemoSocket = {
    readonly readyState: number;
    send(data: string): void;
};

type TOrder = { orderId: string; amount: number; cardDeclined: boolean };

const RUN_EVERY_MS = 2400;
const OPEN = 1;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const jitter = (ms: number) => ms * (0.7 + Math.random() * 0.6);

const declinedOnce = new Set<string>();

const orderPlaced = cnsCollateral<TOrder>();

const inventory = cnsNeuron({ stockReserved: cnsCollateral<TOrder>() }).dendrite({
    collateral: orderPlaced,
    response: async (order, axon) => {
        await wait(jitter(320));
        return axon.stockReserved.createSignal(order);
    },
});

const fraudCheck = cnsNeuron({ orderCleared: cnsCollateral<TOrder>() }).dendrite({
    collateral: inventory.axon.stockReserved,
    response: async (order, axon) => {
        await wait(jitter(220));
        return axon.orderCleared.createSignal(order);
    },
});

const payment = cnsNeuron({ paymentCaptured: cnsCollateral<TOrder>() }).dendrite({
    collateral: fraudCheck.axon.orderCleared,
    response: async (order, axon) => {
        await wait(jitter(480));
        if (order.cardDeclined && !declinedOnce.has(order.orderId)) {
            declinedOnce.add(order.orderId);
            throw new Error('card declined by the issuer');
        }
        return axon.paymentCaptured.createSignal(order);
    },
});

const mailer = cnsNeuron({ receiptSent: cnsCollateral<{ orderId: string }>() }).dendrite({
    collateral: payment.axon.paymentCaptured,
    response: async (order, axon) => {
        await wait(jitter(260));
        return axon.receiptSent.createSignal({ orderId: order.orderId });
    },
});

const shipping = cnsNeuron({ orderShipped: cnsCollateral<{ orderId: string }>() }).dendrite({
    collateral: payment.axon.paymentCaptured,
    response: async (order, axon) => {
        await wait(jitter(620));
        return axon.orderShipped.createSignal({ orderId: order.orderId });
    },
});

const analytics = cnsNeuron({}).dendrite({
    collateral: shipping.axon.orderShipped,
    response: async () => {
        await wait(jitter(120));
    },
});

export function startDevToolsDemo(): { connect(socket: TDevToolsDemoSocket): (data: string) => void; disconnect(socket: TDevToolsDemoSocket): void } {
    const neurons = { inventory, fraudCheck, payment, mailer, shipping, analytics };
    const cns = new CNS(Object.values(neurons));
    const registry = CNSPersistOptionsRegistryFactory.create({ ...neurons, orderPlaced });
    const server = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), new CNSInMemoryStimulationRepository());

    let onCommand: ((command: any) => void) | undefined;
    const appSocket: TDevToolsDemoSocket = {
        readyState: OPEN,
        send: data => {
            const message = JSON.parse(data);
            if (message?.type === 'cns.stimulation.resume' || message?.type === 'cns.stimulation.launch') onCommand?.(message);
        },
    };
    const appTransport: ICNSDevToolsTransport = {
        sendBatch: message => server.handleMessage(appSocket as never, JSON.stringify({ type: 'batch', items: message.items })),
        onStimulationCommand: handler => {
            onCommand = handler;
            return () => {
                onCommand = undefined;
            };
        },
    };

    const devtools = new CNSDevTools('demo-shop', appTransport, { cnsId: 'demo-shop:orders', appName: 'Demo shop', trackStimulations: true });
    devtools.registerCNS(cns, registry);

    let orderNumber = 1000;
    const placeOrder = () => {
        orderNumber++;
        cns.stimulate(
            orderPlaced.createSignal({ orderId: `order-${orderNumber}`, amount: 20 + (orderNumber % 7) * 15, cardDeclined: orderNumber % 5 === 0 })
        ).waitUntilComplete().catch(() => undefined);
    };
    placeOrder();
    setInterval(placeOrder, RUN_EVERY_MS);

    return {
        connect: socket => data => {
            void server.handleMessage(socket as never, data);
        },
        disconnect: socket => server.removeClient(socket as never),
    };
}
