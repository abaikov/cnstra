import { CNS, collateral, neuron } from '@cnstra/core';
import { CNSDevTools } from '@cnstra/devtools';
import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import { CNSDevToolsServer } from '@cnstra/devtools-server';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository, CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { CNSAppCommandDTOSchema } from '@cnstra/devtools-dto';
import type { TCNSAppCommandDTO } from '@cnstra/devtools-dto';
import type { TCNSDevToolsDemoSocket } from '../../types/TCNSDevToolsDemoSocket';

type TOrder = { orderId: string; amount: number; cardDeclined: boolean };

const RUN_EVERY_MS = 2400;
const SOCKET_OPEN = 1;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const jitter = (ms: number) => ms * (0.7 + Math.random() * 0.6);

const declinedOnce = new Set<string>();

const orderPlaced = collateral<TOrder>();

const inventory = neuron({ stockReserved: collateral<TOrder>() }).dendrite({
    collateral: orderPlaced,
    response: async (order, axon) => {
        await wait(jitter(320));
        return axon.stockReserved.createSignal(order);
    },
});

const fraudCheck = neuron({ orderCleared: collateral<TOrder>() }).dendrite({
    collateral: inventory.axon.stockReserved,
    response: async (order, axon) => {
        await wait(jitter(220));
        return axon.orderCleared.createSignal(order);
    },
});

const payment = neuron({ paymentCaptured: collateral<TOrder>() }).dendrite({
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

const mailer = neuron({ receiptSent: collateral<{ orderId: string }>() }).dendrite({
    collateral: payment.axon.paymentCaptured,
    response: async (order, axon) => {
        await wait(jitter(260));
        return axon.receiptSent.createSignal({ orderId: order.orderId });
    },
});

const shipping = neuron({ orderShipped: collateral<{ orderId: string }>() }).dendrite({
    collateral: payment.axon.paymentCaptured,
    response: async (order, axon) => {
        await wait(jitter(620));
        return axon.orderShipped.createSignal({ orderId: order.orderId });
    },
});

const analytics = neuron({}).dendrite({
    collateral: shipping.axon.orderShipped,
    response: async () => {
        await wait(jitter(120));
    },
});

const orderDelivered = collateral<{ orderId: string }>();
const reviewReceived = collateral<{ orderId: string }>();

const delivery = neuron({ orderDelivered }).dendrite({
    collateral: shipping.axon.orderShipped,
    response: async (shipment, axon) => {
        await wait(jitter(540));
        return axon.orderDelivered.createSignal(shipment);
    },
});

const reviews = neuron({ reviewReceived }).dendrite({
    collateral: orderDelivered,
    response: async (delivered, axon) => {
        await wait(jitter(360));
        return axon.reviewReceived.createSignal(delivered);
    },
});

const reactionTo = (reacted: typeof orderDelivered, ms: number) =>
    neuron({}).dendrite({
        collateral: reacted,
        response: async () => {
            await wait(jitter(ms));
        },
    });

const deliveryReactions = {
    reviews,
    deliveryNotifier: reactionTo(orderDelivered, 140),
    loyaltyPoints: reactionTo(orderDelivered, 180),
    invoicing: reactionTo(orderDelivered, 220),
    warehouseRestock: reactionTo(orderDelivered, 260),
    carrierRating: reactionTo(orderDelivered, 120),
    returnsWindow: reactionTo(orderDelivered, 160),
    salesReport: reactionTo(orderDelivered, 200),
    crmSync: reactionTo(orderDelivered, 240),
    partnerWebhook: reactionTo(orderDelivered, 300),
    referralProgram: reactionTo(orderDelivered, 130),
    deliveryAudit: reactionTo(orderDelivered, 170),
};

const reviewReactions = {
    reviewModeration: reactionTo(reviewReceived, 150),
    productRatings: reactionTo(reviewReceived, 190),
    sellerScore: reactionTo(reviewReceived, 110),
    reviewRewards: reactionTo(reviewReceived, 230),
    testimonials: reactionTo(reviewReceived, 170),
};

export function startDevToolsDemo(): { connect(socket: TCNSDevToolsDemoSocket): (data: string) => void; disconnect(socket: TCNSDevToolsDemoSocket): void } {
    const neurons = { inventory, fraudCheck, payment, mailer, shipping, analytics, delivery, ...deliveryReactions, ...reviewReactions };
    const cns = new CNS(Object.values(neurons));
    const registry = CNSPersistOptionsRegistryFactory.create({ ...neurons, orderPlaced });
    const server = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), new CNSInMemoryStimulationRepository());

    let onCommand: ((command: TCNSAppCommandDTO) => void) | undefined;
    const appSocket: TCNSDevToolsDemoSocket = {
        readyState: SOCKET_OPEN,
        send: data => {
            const command = CNSAppCommandDTOSchema.safeParse(JSON.parse(data));
            if (command.success) onCommand?.(command.data);
        },
    };
    const appTransport: ICNSDevToolsTransport = {
        sendBatch: batch => server.handleMessage(appSocket as never, JSON.stringify({ type: 'batch', items: batch.items })),
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
