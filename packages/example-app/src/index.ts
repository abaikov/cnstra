import { CNS, cnsCollateral, cnsNeuronFactory } from '@cnstra/core';
import { CNSPersistOptionsRegistryFactory } from '@cnstra/persist';
import { CNSInMemoryJobRepository } from '@cnstra/jobs';
import { CNSJobs } from '@cnstra/jobs-adapter';
import type { ICNSScheduledStimulationReader, TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import {
    generateBigTopology,
    generateBigStimulations,
    SeedBigStimulationRepository,
} from './seed-big.js';
// DevTools client is loaded dynamically when enabled
import { WebSocket as NodeWebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// DevTools server modules will be loaded dynamically to work without workspace install
const DEVTOOLS_ENABLED =
    process.env.CNSTRA_DEVTOOLS_ENABLED !== '0' &&
    process.env.CNSTRA_DEVTOOLS_ENABLED !== 'false';
const parseFlag = (v?: string) => v !== '0' && v !== 'false';
const DEVTOOLS_CLIENT_ENABLED =
    process.env.CNSTRA_DEVTOOLS_CLIENT !== undefined
        ? parseFlag(process.env.CNSTRA_DEVTOOLS_CLIENT)
        : DEVTOOLS_ENABLED;
const DEVTOOLS_SERVER_ENABLED =
    process.env.CNSTRA_DEVTOOLS_SERVER !== undefined
        ? parseFlag(process.env.CNSTRA_DEVTOOLS_SERVER)
        : DEVTOOLS_ENABLED;

// Big synthetic dataset mode (SEED_BIG=1): populate hundreds of neurons/collaterals
// + ~18k stimulations over ~90 days, and SKIP the live e-commerce demo/client so the
// dataset stays pure + deterministic. Run: `SEED_BIG=1 PORT=8080 node dist/index.js`.
const SEED_BIG =
    process.env.SEED_BIG === '1' || process.env.SEED_BIG === 'true';
const SEED_APP_ID = 'bigdata-app';
const SEED_CNS_ID = 'bigdata:core';

// E-commerce domain collaterals
const userLogin = cnsCollateral<{ email: string; password: string }>();
const userAuthenticated = cnsCollateral<{
    userId: string;
    token: string;
    email: string;
}>();
const searchProducts = cnsCollateral<{
    query: string;
    category?: string;
    userId?: string;
}>();
const productsFound = cnsCollateral<{
    products: Product[];
    query: string;
    totalCount: number;
}>();
const addToCart = cnsCollateral<{
    userId: string;
    productId: string;
    quantity: number;
}>();
const cartUpdated = cnsCollateral<{
    userId: string;
    cartItems: CartItem[];
    total: number;
}>();
const checkout = cnsCollateral<{
    userId: string;
    cartItems: CartItem[];
    paymentMethod: string;
}>();
const orderCreated = cnsCollateral<{
    orderId: string;
    userId: string;
    items: CartItem[];
    total: number;
}>();
const processPayment = cnsCollateral<{
    orderId: string;
    amount: number;
    paymentMethod: string;
}>();
const paymentProcessed = cnsCollateral<{
    orderId: string;
    status: 'success' | 'failed';
    transactionId?: string;
}>();
const sendNotification = cnsCollateral<{
    userId: string;
    type: string;
    message: string;
    email?: string;
}>();
const notificationSent = cnsCollateral<{
    userId: string;
    type: string;
    status: 'sent' | 'failed';
}>();
const inventoryCheck = cnsCollateral<{ productId: string; quantity: number }>();
const inventoryUpdated = cnsCollateral<{
    productId: string;
    available: number;
    reserved: number;
}>();

// Type definitions
interface Product {
    id: string;
    name: string;
    price: number;
    category: string;
    stock: number;
    description: string;
}

interface CartItem {
    productId: string;
    quantity: number;
    price: number;
    name: string;
}

interface User {
    id: string;
    email: string;
    name: string;
    isAuthenticated: boolean;
}

// In-memory data stores
const users = new Map<string, User>();
const products = new Map<string, Product>();
const carts = new Map<string, CartItem[]>();
const orders = new Map<string, any>();
const inventory = new Map<string, { available: number; reserved: number }>();
// Session store (was a per-neuron ctx bag; now a plain module map for the demo).
const sessions = new Map<string, string>();

// Initialize sample data
const sampleProducts: Product[] = [
    {
        id: 'p1',
        name: 'Wireless Headphones',
        price: 99.99,
        category: 'electronics',
        stock: 50,
        description: 'High-quality wireless headphones',
    },
    {
        id: 'p2',
        name: 'Smart Watch',
        price: 299.99,
        category: 'electronics',
        stock: 25,
        description: 'Latest smart watch with health tracking',
    },
    {
        id: 'p3',
        name: 'Running Shoes',
        price: 129.99,
        category: 'sports',
        stock: 100,
        description: 'Professional running shoes',
    },
    {
        id: 'p4',
        name: 'Coffee Maker',
        price: 79.99,
        category: 'home',
        stock: 30,
        description: 'Automatic drip coffee maker',
    },
    {
        id: 'p5',
        name: 'Yoga Mat',
        price: 39.99,
        category: 'sports',
        stock: 75,
        description: 'Non-slip yoga mat',
    },
    {
        id: 'p6',
        name: 'Bluetooth Speaker',
        price: 59.99,
        category: 'electronics',
        stock: 40,
        description: 'Portable Bluetooth speaker',
    },
];

sampleProducts.forEach(product => {
    products.set(product.id, product);
    inventory.set(product.id, { available: product.stock, reserved: 0 });
});

const sampleUsers: User[] = [
    {
        id: 'u1',
        email: 'john@example.com',
        name: 'John Doe',
        isAuthenticated: false,
    },
    {
        id: 'u2',
        email: 'jane@example.com',
        name: 'Jane Smith',
        isAuthenticated: false,
    },
    {
        id: 'u3',
        email: 'bob@example.com',
        name: 'Bob Johnson',
        isAuthenticated: false,
    },
];

sampleUsers.forEach(user => users.set(user.id, user));

// Authentication Service
const authNeuron = cnsNeuronFactory()
    .neuron({
        userAuthenticated,
    })
    .bind(
        { userLogin },
        {
            userLogin: ({ email, password }, axon) => {
                console.log(`🔐 Auth attempt for: ${email}`);

                // Find user
                const user = Array.from(users.values()).find(
                    u => u.email === email
                );

                if (user && password === 'password123') {
                    // Simple auth for demo
                    const token = `token_${user.id}_${Date.now()}`;
                    user.isAuthenticated = true;

                    // Store session
                    sessions.set(token, user.id);

                    return axon.userAuthenticated.createSignal({
                        userId: user.id,
                        token,
                        email: user.email,
                    });
                } else {

                    console.log(`❌ Auth failed for: ${email}`);
                    return undefined;
                }
            },
        }
    );

// Product Search Service
const searchNeuron = cnsNeuronFactory()
    .neuron({
        productsFound,
    })
    .bind(
        { searchProducts },
        {
            searchProducts: ({ query, category, userId }, axon) => {
                console.log(
                    `🔍 Searching products: "${query}" in category: ${
                        category || 'all'
                    }`
                );

                let results = Array.from(products.values());

                // Filter by category
                if (category) {
                    results = results.filter(p => p.category === category);
                }

                // Filter by query
                if (query) {
                    const searchTerm = query.toLowerCase();
                    results = results.filter(
                        p =>
                            p.name.toLowerCase().includes(searchTerm) ||
                            p.description.toLowerCase().includes(searchTerm)
                    );
                }

                return axon.productsFound.createSignal({
                    products: results,
                    query,
                    totalCount: results.length,
                });
            },
        }
    );

// Shopping Cart Service
const cartNeuron = cnsNeuronFactory()
    .neuron({
        cartUpdated,
        inventoryCheck,
    })
    .bind(
        { addToCart },
        {
            addToCart: ({ userId, productId, quantity }, axon) => {
                console.log(
                    `🛒 Adding to cart: ${quantity}x ${productId} for user ${userId}`
                );

                const product = products.get(productId);
                if (!product) {
                    console.log(`❌ Product not found: ${productId}`);
                    return undefined;
                }

                // Check inventory
                axon.inventoryCheck.createSignal({
                    productId,
                    quantity,
                });

                // Get current cart
                let cart = carts.get(userId) || [];

                // Add or update item
                const existingItemIndex = cart.findIndex(
                    item => item.productId === productId
                );
                if (existingItemIndex >= 0) {
                    cart[existingItemIndex].quantity += quantity;
                } else {
                    cart.push({
                        productId,
                        quantity,
                        price: product.price,
                        name: product.name,
                    });
                }

                carts.set(userId, cart);

                const total = cart.reduce(
                    (sum, item) => sum + item.price * item.quantity,
                    0
                );

                return axon.cartUpdated.createSignal({
                    userId,
                    cartItems: cart,
                    total,
                });
            },
        }
    );

// Order Service
const orderNeuron = cnsNeuronFactory()
    .neuron({
        orderCreated,
        processPayment,
    })
    .bind(
        { checkout },
        {
            checkout: ({ userId, cartItems, paymentMethod }, axon) => {
                console.log(`💳 Processing checkout for user ${userId}`);

                const orderId = `order_${Date.now()}_${userId}`;
                const total = cartItems.reduce(
                    (sum, item) => sum + item.price * item.quantity,
                    0
                );

                const order = {
                    id: orderId,
                    userId,
                    items: cartItems,
                    total,
                    status: 'pending',
                    createdAt: Date.now(),
                };

                orders.set(orderId, order);

                // Clear cart
                carts.delete(userId);

                // Trigger payment processing
                axon.processPayment.createSignal({
                    orderId,
                    amount: total,
                    paymentMethod,
                });

                return axon.orderCreated.createSignal({
                    orderId,
                    userId,
                    items: cartItems,
                    total,
                });
            },
        }
    );

// Payment Service
const paymentNeuron = cnsNeuronFactory()
    .neuron({
        paymentProcessed,
    })
    .bind(
        { processPayment },
        {
            processPayment: ({ orderId, amount, paymentMethod }, axon) => {
                console.log(
                    `💰 Processing payment: $${amount} for order ${orderId}`
                );

                // Simulate 90% success rate
                const success = Math.random() > 0.1;
                const status = success ? 'success' : 'failed';
                const transactionId = success ? `txn_${Date.now()}` : undefined;

                const order = orders.get(orderId);
                if (order) {
                    order.status = status;
                    order.transactionId = transactionId;
                }

                // Send notification
                if (order) {
                    const user = users.get(order.userId);
                }

                return axon.paymentProcessed.createSignal({
                    orderId,
                    status,
                    transactionId,
                });
            },
        }
    );

// Notification Service
const notificationNeuron = cnsNeuronFactory()
    .neuron({
        notificationSent,
    })
    .bind(
        { sendNotification },
        {
            sendNotification: ({ userId, type, message, email }, axon) => {
                console.log(
                    `📧 Sending ${type} notification to user ${userId}: ${message}`
                );

                // Simulate notification sending
                const success = Math.random() > 0.05; // 95% success rate
                const status = success ? 'sent' : 'failed';

                return axon.notificationSent.createSignal({
                    userId,
                    type,
                    status,
                });
            },
        }
    );

// Inventory Service
const inventoryNeuron = cnsNeuronFactory()
    .neuron({
        inventoryUpdated,
    })
    .bind(
        { inventoryCheck },
        {
            inventoryCheck: ({ productId, quantity }, axon) => {
                console.log(
                    `📦 Checking inventory for ${productId}: ${quantity} units`
                );

                const currentInventory = inventory.get(productId) || {
                    available: 0,
                    reserved: 0,
                };

                if (currentInventory.available >= quantity) {
                    // Reserve inventory
                    currentInventory.available -= quantity;
                    currentInventory.reserved += quantity;
                    inventory.set(productId, currentInventory);

                    console.log(
                        `✅ Inventory reserved: ${quantity} units of ${productId}`
                    );
                } else {
                    console.log(
                        `❌ Insufficient inventory for ${productId}: requested ${quantity}, available ${currentInventory.available}`
                    );
                }

                return axon.inventoryUpdated.createSignal({
                    productId,
                    available: currentInventory.available,
                    reserved: currentInventory.reserved,
                });
            },
        }
    );

// Analytics Service
const domainEvents = {
    userAuthenticated,
    productsFound,
    cartUpdated,
    orderCreated,
    paymentProcessed,
    notificationSent,
    inventoryUpdated,
};

const analyticsNeuron = cnsNeuronFactory()
    .neuron({})
    .bind(domainEvents, {
        userAuthenticated: ({ userId }) => console.log(`📊 metric user_login_success for user ${userId}`),
        productsFound: ({ query, totalCount }) => console.log(`📊 metric product_search "${query}": ${totalCount} results`),
        cartUpdated: ({ userId, total }) => console.log(`📊 metric add_to_cart for user ${userId}, cart total ${total}`),
        orderCreated: ({ orderId, total }) => console.log(`📊 metric order_created ${orderId}: ${total}`),
        paymentProcessed: ({ orderId, status }) => console.log(`📊 metric payment_${status} for order ${orderId}`),
        notificationSent: ({ userId, type, status }) => console.log(`📊 metric notification_${status} ${type} for user ${userId}`),
        inventoryUpdated: ({ productId, available }) => console.log(`📊 metric inventory ${productId}: ${available} available`),
    });

const auditNeuron = cnsNeuronFactory()
    .neuron({})
    .bind(domainEvents, {
        userAuthenticated: payload => console.log(`📋 Audit user_login`, JSON.stringify({ userId: payload.userId, email: payload.email })),
        productsFound: payload => console.log(`📋 Audit product_search`, JSON.stringify({ query: payload.query, totalCount: payload.totalCount })),
        cartUpdated: payload => console.log(`📋 Audit cart_updated`, JSON.stringify({ userId: payload.userId, total: payload.total })),
        orderCreated: payload => console.log(`📋 Audit order_created`, JSON.stringify({ orderId: payload.orderId, userId: payload.userId, total: payload.total })),
        paymentProcessed: payload => console.log(`📋 Audit payment_processed`, JSON.stringify(payload)),
        notificationSent: payload => console.log(`📋 Audit notification_sent`, JSON.stringify(payload)),
        inventoryUpdated: payload => console.log(`📋 Audit inventory_updated`, JSON.stringify(payload)),
    });

// Create DevTools server + UI HTTP server first (only when devtools enabled)
const __dirname = dirname(fileURLToPath(import.meta.url));
const panelUIDir = join(__dirname, '..', '..', 'devtools-panel-ui', 'dist');

const httpServer = createServer((req, res) => {
    // Serve DevTools Panel UI static files
    let filePath = join(
        panelUIDir,
        req?.url === '/' || !req?.url ? 'index.html' : req.url
    );

    if (!existsSync(filePath)) {
        // Fallback to index.html for SPA
        filePath = join(panelUIDir, 'index.html');
    }

    if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end(
            'DevTools Panel UI not found. Build @cnstra/devtools-panel-ui first.'
        );
        return;
    }
    try {
        const content = readFileSync(filePath);
        const ext = filePath.split('.').pop();
        const contentTypes: Record<string, string> = {
            html: 'text/html',
            js: 'application/javascript',
            css: 'text/css',
            svg: 'image/svg+xml',
            ico: 'image/x-icon',
            png: 'image/png',
            ttf: 'font/ttf',
            json: 'application/json',
        };
        res.writeHead(200, {
            'Content-Type': contentTypes[ext || ''] || 'text/plain',
        });
        res.end(content);
    } catch (e) {
        res.writeHead(500);
        res.end('Server error');
    }
});

const port = Number(process.env.PORT || 8080);
if (DEVTOOLS_SERVER_ENABLED) {
    httpServer.listen(port, () => {
        console.log('🚀 DevTools Server started:');
        console.log(`   📡 WebSocket: ws://localhost:${port}`);
        console.log(`   🌐 DevTools UI: http://localhost:${port}`);
    });
} else {
    console.log('🚫 DevTools Server is disabled (CNSTRA_DEVTOOLS_SERVER=0)');
}

// Attach WebSocket server and wire DevTools server logic
const wss = new WebSocketServer({ server: httpServer });
let devToolsServer: any;
const __localApps = new Map<
    string,
    {
        appId: string;
        appName: string;
        firstSeenAt: number;
        lastSeenAt: number;
    }
>();

// Cleanup stale apps every 30 seconds (consider apps stale after 60 seconds of inactivity)
const STALE_APP_THRESHOLD = 60 * 1000; // 60 seconds
const CLEANUP_INTERVAL = 30 * 1000; // 30 seconds

setInterval(() => {
    const now = Date.now();
    const staleApps: string[] = [];

    for (const [appId, app] of __localApps.entries()) {
        if (now - app.lastSeenAt > STALE_APP_THRESHOLD) {
            staleApps.push(appId);
        }
    }

    if (staleApps.length > 0) {
        console.log(
            `🧹 Cleaning up ${staleApps.length} stale apps: [${staleApps.join(
                ', '
            )}]`
        );
        staleApps.forEach(appId => {
            __localApps.delete(appId);
            // Notify clients that app disconnected
            const disconnectPayload = JSON.stringify({
                type: 'app:disconnected',
                appId,
            });
            wss.clients.forEach(client => {
                // @ts-ignore
                if (client.readyState === 1) client.send(disconnectPayload);
            });
        });

        // Send updated app list
        const payload = JSON.stringify({
            type: 'apps:active',
            apps: Array.from(__localApps.values()),
        });
        wss.clients.forEach(client => {
            // @ts-ignore
            if (client.readyState === 1) client.send(payload);
        });
    }
}, CLEANUP_INTERVAL);

// Buffer messages until server is ready
const messageBuffer: Array<{ ws: any; message: any }> = [];

(async () => {
    try {
        if (!DEVTOOLS_SERVER_ENABLED) throw new Error('DevTools disabled');
        const { CNSDevToolsServer } = await import('@cnstra/devtools-server');
        const { CNSDevToolsServerRepositoryInMemory } = await import(
            '@cnstra/devtools-server-repository-in-memory'
        );
        const repository = new CNSDevToolsServerRepositoryInMemory();

        // Name-based resumable store for the trackStimulations producer path. Defaults to
        // in-memory; switch to Postgres with ADMIN_STORE=postgres (or a DATABASE_URL).
        const usePostgres =
            process.env.ADMIN_STORE === 'postgres' ||
            !!process.env.DATABASE_URL;
        let stimulationRepository: any;
        if (SEED_BIG) {
            console.log('🌱 SEED_BIG: generating big synthetic dataset…');
            const topo = generateBigTopology(
                SEED_APP_ID,
                SEED_CNS_ID,
                'Big Data Demo (SEED_BIG)'
            );
            const buckets = generateBigStimulations(topo, SEED_CNS_ID);
            stimulationRepository = new SeedBigStimulationRepository(buckets);
            // Inject the synthetic app + topology so topology.query returns hundreds
            // of neurons/collaterals and the entity lists/typeaheads populate.
            repository.saveTopology(topo as any);
            console.log(
                `🌱 SEED_BIG ready: ${topo.neurons.length} neurons · ` +
                    `${topo.collaterals.length} collaterals · ` +
                    `${buckets.stimulations.length} stimulations over ~90 days`
            );
        } else if (usePostgres) {
            const { CNSPostgresStimulationRepository } = await import(
                '@cnstra/persist-postgres'
            );
            stimulationRepository = new CNSPostgresStimulationRepository({
                connectionString:
                    process.env.DATABASE_URL ||
                    'postgres://postgres:postgres@localhost:5432/postgres',
            });
            console.log('🗄️  Resumable stimulation store: Postgres');
        } else {
            const { CNSInMemoryStimulationRepository } = await import(
                '@cnstra/persist'
            );
            stimulationRepository = new CNSInMemoryStimulationRepository();
            console.log('🗄️  Resumable stimulation store: in-memory');
        }

        let jobsReader: ICNSScheduledStimulationReader | undefined;
        const scheduledStimulationReader: ICNSScheduledStimulationReader = {
            list: (filter, cursor, limit) => (jobsReader ??= jobs.scheduledStimulationReader()).list(filter, cursor, limit),
        };
        let jobsActions: TCNSDevToolsActionMiddleware | undefined;
        const jobsActionLink: TCNSDevToolsActionMiddleware = (action, next) =>
            action.type === 'command' || (action.type === 'launch' && action.replayOf === undefined)
                ? (jobsActions ??= jobs.actions())(action, next)
                : next();
        devToolsServer = new CNSDevToolsServer(
            repository,
            stimulationRepository,
            [jobsActionLink],
            {},
            scheduledStimulationReader
        );
        console.log('🔧 DevTools server core is initialized');

        // Process buffered messages
        console.log(`📦 Processing ${messageBuffer.length} buffered messages`);
        for (const { ws, message } of messageBuffer) {
            await processMessage(ws, message);
        }
        messageBuffer.length = 0; // Clear buffer
    } catch {
        console.warn(
            DEVTOOLS_SERVER_ENABLED
                ? '⚠️ DevTools server packages not found. Only UI static will be served.'
                : 'ℹ️ DevTools disabled. Skipping server core init.'
        );
    }
})();

wss.on('connection', ws => {
    ws.on('message', async data => {
        try {
            const message = JSON.parse(String(data));
            console.log(
                '📥 Raw WebSocket message received:',
                message.type,
                message.items?.length ? `(batch: ${message.items.length})` : ''
            );

            // Buffer messages if server is not ready
            if (!devToolsServer) {
                console.log('📦 Buffering message until server is ready');
                messageBuffer.push({ ws, message });
                return;
            }

            await processMessage(ws, message);
        } catch {
            // ignore malformed messages
        }
    });
});

// Extract message processing logic
async function processMessage(ws: any, message: any): Promise<void> {
    if (devToolsServer) {
        // Simply proxy all messages to the server - no custom batch processing
        console.log('📤 Example-app proxying message:', message?.type);

        // Handle all messages through the server
        const res = await devToolsServer.handleMessage(ws, message);
        if (res) {
            console.log('📤 Example-app broadcasting response:', res.type);
            const payload = JSON.stringify(res);
            wss.clients.forEach(client => {
                if (client.readyState === 1) client.send(payload);
            });
        }

        if (message?.type === 'devtools-client-connect') {
            // Register this connection as a DevTools client to receive live broadcasts
            try {
                devToolsServer.addClient(ws as any);
            } catch {}
            const apps = await devToolsServer.getActiveApps();
            console.log(
                '📋 Sending apps to client:',
                JSON.stringify(apps, null, 2)
            );
            ws.send(
                JSON.stringify({
                    type: 'apps:active',
                    apps,
                })
            );
            // also send cached topology (like REST bootstrap over WS)
            const topo = await devToolsServer.handleMessage(
                ws as any,
                {
                    type: 'apps:get-topology',
                } as any
            );
            if (topo) ws.send(JSON.stringify(topo));
            return;
        }
    } else {
        // Fallback minimal behavior if server packages are not installed
        if (message?.type === 'batch' && Array.isArray(message.items)) {
            for (const item of message.items) {
                if (item?.type === 'init') {
                    const appId = item.devToolsInstanceId as string;
                    const appName = item.appName as string;
                    const now = Date.now();
                    const existing = __localApps.get(appId);
                    __localApps.set(appId, {
                        appId,
                        appName,
                        firstSeenAt: existing?.firstSeenAt ?? now,
                        lastSeenAt: now,
                    });
                    const payload = JSON.stringify({
                        type: 'apps:active',
                        apps: Array.from(__localApps.values()),
                    });
                    wss.clients.forEach(client => {
                        // @ts-ignore
                        if (client.readyState === 1) client.send(payload);
                    });
                }
            }
            return;
        }
        if (message?.type === 'init') {
            const appId = message.devToolsInstanceId as string;
            const appName = message.appName as string;
            const now = Date.now();
            const existing = __localApps.get(appId);
            __localApps.set(appId, {
                appId,
                appName,
                firstSeenAt: existing?.firstSeenAt ?? now,
                lastSeenAt: now,
            });
            const payload = JSON.stringify({
                type: 'apps:active',
                apps: Array.from(__localApps.values()),
            });
            wss.clients.forEach(client => {
                // @ts-ignore
                if (client.readyState === 1) client.send(payload);
            });
            return;
        }
        if (message?.type === 'devtools-client-connect') {
            // Send current apps to the connecting client
            const apps = Array.from(__localApps.values());
            console.log(
                '📋 Fallback sending apps to client:',
                JSON.stringify(apps, null, 2)
            );
            ws.send(
                JSON.stringify({
                    type: 'apps:active',
                    apps,
                })
            );
            return;
        }
    }
}

// Create CNS instance with all neurons
const cns = new CNS([
    authNeuron,
    searchNeuron,
    cartNeuron,
    orderNeuron,
    paymentNeuron,
    notificationNeuron,
    inventoryNeuron,
    analyticsNeuron,
    auditNeuron,
]);

export const registry = CNSPersistOptionsRegistryFactory.create({
    authNeuron,
    searchNeuron,
    cartNeuron,
    orderNeuron,
    paymentNeuron,
    notificationNeuron,
    inventoryNeuron,
    analyticsNeuron,
    auditNeuron,
    userLogin,
    searchProducts,
    addToCart,
    checkout,
    sendNotification,
});

const jobRepository = new CNSInMemoryJobRepository();
const jobs = new CNSJobs({ cns, registry, repository: jobRepository })
    .type(checkout)
    .type(processPayment)
    .type(sendNotification, {
        description: 'Sends a notification to a user',
        payloadSchema: {
            type: 'object',
            properties: {
                userId: { type: 'string' },
                type: { type: 'string', enum: ['reminder', 'digest', 'promo'] },
                message: { type: 'string' },
                email: { type: 'string' },
            },
            required: ['userId', 'type', 'message'],
        },
    });
await jobRepository.upsertSchedules('sendNotification', [{ scheduleId: 'daily-digest', cron: '0 9 * * *', tz: 'UTC' }], false);
const hour = 3_600_000;
await jobs.enqueue(checkout, { userId: 'user-1', cartItems: [], paymentMethod: 'card' }, { jobId: 'checkout-later', runAfter: Date.now() + hour });
await jobs.enqueue(processPayment, { orderId: 'order-42', amount: 99, paymentMethod: 'card' }, { jobId: 'payment-later', runAfter: Date.now() + 2 * hour, jobKey: 'order-42' });
await jobs.enqueue(sendNotification, { userId: 'user-2', type: 'reminder', message: 'Your cart is waiting' }, { jobId: 'reminder-tomorrow', runAfter: Date.now() + 24 * hour });

// Setup DevTools with WebSocket transport (optional). Under SEED_BIG we do NOT
// register the live CNS/demo — the synthetic dataset IS the data.
console.log('🔧 DevTools CLIENT enabled:', DEVTOOLS_CLIENT_ENABLED, 'SEED_BIG:', SEED_BIG);
if (DEVTOOLS_CLIENT_ENABLED && !SEED_BIG) {
    const { CNSDevTools } = await import('@cnstra/devtools');
    const { CNSDevToolsTransportWs } = await import(
        '@cnstra/devtools-transport-ws'
    );
    const wsUrl =
        process.env.CNSTRA_DEVTOOLS_WS_URL || `ws://localhost:${port}`;
    const transport = new CNSDevToolsTransportWs({
        url: wsUrl,
        webSocketImpl: NodeWebSocket as any,
    });

    const devtools = new CNSDevTools('ecommerce-app', transport as any, {
        cnsId: 'ecommerce-app:core',
        appName: 'E-commerce Demo App',
        trackStimulations: true,
    });
    devtools.registerCNS(cns, registry);

    console.log('🚀 E-commerce CNS app started with DevTools CLIENT enabled');
    console.log(`   📡 Connecting to DevTools server: ${wsUrl}`);
    console.log('   🎭 Complex demo scenarios will run every 8 seconds');
    console.log('   ⏳ Waiting for DevTools connection...');
} else {
    console.log('🚀 E-commerce CNS app started WITHOUT DevTools CLIENT');
}

console.log(
    '🔎 Open DevTools at http://localhost:8080 → "⚡ Stimulations" to watch the ' +
        'name-based Stimulation → Attempt → Task activity live.'
);

// Demo realistic e-commerce flows
async function runDemo() {
    console.log('🎭 Demo starting in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n🎭 Running e-commerce demo scenarios...');

    try {
        // Scenario 1: User Authentication
        const user =
            sampleUsers[Math.floor(Math.random() * sampleUsers.length)];
        console.log(`👤 User ${user.name} logging in...`);

        await cns.stimulate(
            userLogin.createSignal({
                email: user.email,
                password: 'password123',
            })
        );

        await new Promise(resolve => setTimeout(resolve, 800));

        // Scenario 2: Product Search
        const searchQueries = [
            'headphones',
            'smart watch',
            'running',
            'coffee',
            'bluetooth',
        ];
        const categories = ['electronics', 'sports', 'home'];
        const query =
            searchQueries[Math.floor(Math.random() * searchQueries.length)];
        const category =
            Math.random() > 0.5
                ? categories[Math.floor(Math.random() * categories.length)]
                : undefined;

        console.log(
            `🔍 Searching for "${query}" in category: ${category || 'all'}`
        );

        await cns.stimulate(
            searchProducts.createSignal({
                query,
                category,
                userId: user.id,
            })
        );

        await new Promise(resolve => setTimeout(resolve, 600));

        // Scenario 3: Add to Cart
        const productIds = Array.from(products.keys());
        const randomProductId =
            productIds[Math.floor(Math.random() * productIds.length)];
        const quantity = Math.floor(Math.random() * 3) + 1;

        console.log(
            `🛒 Adding ${quantity}x ${randomProductId} to cart for ${user.name}`
        );

        await cns.stimulate(
            addToCart.createSignal({
                userId: user.id,
                productId: randomProductId,
                quantity,
            })
        );

        await new Promise(resolve => setTimeout(resolve, 800));

        // Scenario 4: Sometimes proceed to checkout (40% chance)
        if (Math.random() > 0.6) {
            const userCart = carts.get(user.id) || [];
            if (userCart.length > 0) {
                const paymentMethods = ['credit_card', 'paypal', 'apple_pay'];
                const paymentMethod =
                    paymentMethods[
                        Math.floor(Math.random() * paymentMethods.length)
                    ];

                console.log(
                    `💳 ${user.name} checking out with ${paymentMethod}`
                );

                await cns.stimulate(
                    checkout.createSignal({
                        userId: user.id,
                        cartItems: userCart,
                        paymentMethod,
                    })
                );
            }
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        console.log(`📧 Sending the demo completion notification`);
        await cns.stimulate(
            sendNotification.createSignal({
                userId: user.id,
                type: 'demo_scenario_completed',
                message: `Thanks for shopping, ${user.name}!`,
                email: user.email,
            })
        );

        await new Promise(resolve => setTimeout(resolve, 300));

        // Scenario 6: Random search activity (simulate other users)
        if (Math.random() > 0.3) {
            const randomUser =
                sampleUsers[Math.floor(Math.random() * sampleUsers.length)];
            const randomQuery =
                searchQueries[Math.floor(Math.random() * searchQueries.length)];

            console.log(
                `🔍 Background search by ${randomUser.name}: "${randomQuery}"`
            );

            await cns.stimulate(
                searchProducts.createSignal({
                    query: randomQuery,
                    userId: randomUser.id,
                })
            );
        }
    } catch (error) {
        console.error('Demo error:', error);
    }

    console.log(
        '✨ E-commerce demo completed! Check DevTools for network activity.\n'
    );

    // Schedule next demo run with slight randomization
    const nextRunDelay = 30000 + Math.random() * 10000; // 30-40 seconds (reduced frequency)
    setTimeout(runDemo, nextRunDelay);
}

// Under SEED_BIG the synthetic dataset is the data — don't run the live demo.
if (!SEED_BIG) {
    runDemo();
} else {
    console.log(
        '🌱 SEED_BIG mode: live demo skipped. Open http://localhost:8080 to explore ~18k stimulations over ~90 days.'
    );
}
