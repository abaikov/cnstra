import { CNS, collateral, withCtx } from '@cnstra/core';
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

// E-commerce domain collaterals
const userLogin = collateral<{ email: string; password: string }>('user-login');
const userAuthenticated = collateral<{
    userId: string;
    token: string;
    email: string;
}>('user-authenticated');
const searchProducts = collateral<{
    query: string;
    category?: string;
    userId?: string;
}>('search-products');
const productsFound = collateral<{
    products: Product[];
    query: string;
    totalCount: number;
}>('products-found');
const addToCart = collateral<{
    userId: string;
    productId: string;
    quantity: number;
}>('add-to-cart');
const cartUpdated = collateral<{
    userId: string;
    cartItems: CartItem[];
    total: number;
}>('cart-updated');
const checkout = collateral<{
    userId: string;
    cartItems: CartItem[];
    paymentMethod: string;
}>('checkout');
const orderCreated = collateral<{
    orderId: string;
    userId: string;
    items: CartItem[];
    total: number;
}>('order-created');
const processPayment = collateral<{
    orderId: string;
    amount: number;
    paymentMethod: string;
}>('process-payment');
const paymentProcessed = collateral<{
    orderId: string;
    status: 'success' | 'failed';
    transactionId?: string;
}>('payment-processed');
const sendNotification = collateral<{
    userId: string;
    type: string;
    message: string;
    email?: string;
}>('send-notification');
const notificationSent = collateral<{
    userId: string;
    type: string;
    status: 'sent' | 'failed';
}>('notification-sent');
const recordMetric = collateral<{
    event: string;
    userId?: string;
    metadata?: any;
}>('record-metric');
const auditLog = collateral<{
    action: string;
    userId?: string;
    details: any;
    timestamp: number;
}>('audit-log');
const inventoryCheck = collateral<{ productId: string; quantity: number }>(
    'inventory-check'
);
const inventoryUpdated = collateral<{
    productId: string;
    available: number;
    reserved: number;
}>('inventory-updated');

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
const authNeuron = withCtx()
    .neuron('auth-service', {
        userAuthenticated,
        recordMetric,
        auditLog,
        sendNotification,
    })
    .bind(
        { userLogin },
        {
            userLogin: ({ email, password }, axon, { set, get }) => {
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
                    set({ sessions: { [token]: user.id } });

                    // Record metric
                    axon.recordMetric.createSignal({
                        event: 'user_login_success',
                        userId: user.id,
                        metadata: { email },
                    });

                    // Audit log
                    axon.auditLog.createSignal({
                        action: 'user_login',
                        userId: user.id,
                        details: { email, success: true },
                        timestamp: Date.now(),
                    });

                    // Send welcome notification
                    axon.sendNotification.createSignal({
                        userId: user.id,
                        type: 'welcome',
                        message: `Welcome back, ${user.name}!`,
                        email: user.email,
                    });

                    return axon.userAuthenticated.createSignal({
                        userId: user.id,
                        token,
                        email: user.email,
                    });
                } else {
                    // Record failed login
                    axon.recordMetric.createSignal({
                        event: 'user_login_failed',
                        metadata: { email },
                    });

                    axon.auditLog.createSignal({
                        action: 'user_login_failed',
                        details: { email },
                        timestamp: Date.now(),
                    });

                    console.log(`❌ Auth failed for: ${email}`);
                    return undefined;
                }
            },
        }
    );

// Product Search Service
const searchNeuron = withCtx()
    .neuron('search-service', {
        productsFound,
        recordMetric,
        auditLog,
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

                // Record search metric
                axon.recordMetric.createSignal({
                    event: 'product_search',
                    userId,
                    metadata: { query, category, resultCount: results.length },
                });

                // Audit log
                axon.auditLog.createSignal({
                    action: 'product_search',
                    userId,
                    details: { query, category, resultCount: results.length },
                    timestamp: Date.now(),
                });

                return axon.productsFound.createSignal({
                    products: results,
                    query,
                    totalCount: results.length,
                });
            },
        }
    );

// Shopping Cart Service
const cartNeuron = withCtx()
    .neuron('cart-service', {
        cartUpdated,
        recordMetric,
        auditLog,
        inventoryCheck,
    })
    .bind(
        { addToCart },
        {
            addToCart: (
                { userId, productId, quantity },
                axon,
                { get, set }
            ) => {
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

                // Record metric
                axon.recordMetric.createSignal({
                    event: 'add_to_cart',
                    userId,
                    metadata: { productId, quantity, cartTotal: total },
                });

                // Audit log
                axon.auditLog.createSignal({
                    action: 'add_to_cart',
                    userId,
                    details: { productId, quantity, newTotal: total },
                    timestamp: Date.now(),
                });

                return axon.cartUpdated.createSignal({
                    userId,
                    cartItems: cart,
                    total,
                });
            },
        }
    );

// Order Service
const orderNeuron = withCtx()
    .neuron('order-service', {
        orderCreated,
        processPayment,
        recordMetric,
        auditLog,
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

                // Record metric
                axon.recordMetric.createSignal({
                    event: 'order_created',
                    userId,
                    metadata: { orderId, total, itemCount: cartItems.length },
                });

                // Audit log
                axon.auditLog.createSignal({
                    action: 'order_created',
                    userId,
                    details: { orderId, total, items: cartItems.length },
                    timestamp: Date.now(),
                });

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
const paymentNeuron = withCtx()
    .neuron('payment-service', {
        paymentProcessed,
        sendNotification,
        recordMetric,
        auditLog,
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

                // Record metric
                axon.recordMetric.createSignal({
                    event: 'payment_processed',
                    userId: order?.userId,
                    metadata: { orderId, amount, status, paymentMethod },
                });

                // Audit log
                axon.auditLog.createSignal({
                    action: 'payment_processed',
                    userId: order?.userId,
                    details: { orderId, amount, status, transactionId },
                    timestamp: Date.now(),
                });

                // Send notification
                if (order) {
                    const user = users.get(order.userId);
                    axon.sendNotification.createSignal({
                        userId: order.userId,
                        type: success ? 'order_confirmation' : 'payment_failed',
                        message: success
                            ? `Your order ${orderId} has been confirmed!`
                            : `Payment failed for order ${orderId}. Please try again.`,
                        email: user?.email,
                    });
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
const notificationNeuron = withCtx()
    .neuron('notification-service', {
        notificationSent,
        recordMetric,
        auditLog,
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

                // Record metric
                axon.recordMetric.createSignal({
                    event: 'notification_sent',
                    userId,
                    metadata: { type, status, email },
                });

                // Audit log
                axon.auditLog.createSignal({
                    action: 'notification_sent',
                    userId,
                    details: { type, status, message },
                    timestamp: Date.now(),
                });

                return axon.notificationSent.createSignal({
                    userId,
                    type,
                    status,
                });
            },
        }
    );

// Inventory Service
const inventoryNeuron = withCtx()
    .neuron('inventory-service', {
        inventoryUpdated,
        recordMetric,
        auditLog,
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

                // Record metric
                axon.recordMetric.createSignal({
                    event: 'inventory_check',
                    metadata: {
                        productId,
                        quantity,
                        available: currentInventory.available,
                    },
                });

                // Audit log
                axon.auditLog.createSignal({
                    action: 'inventory_check',
                    details: { productId, quantity, currentInventory },
                    timestamp: Date.now(),
                });

                return axon.inventoryUpdated.createSignal({
                    productId,
                    available: currentInventory.available,
                    reserved: currentInventory.reserved,
                });
            },
        }
    );

// Analytics Service
const analyticsNeuron = withCtx()
    .neuron('analytics-service', {})
    .bind(
        { recordMetric },
        {
            recordMetric: ({ event, userId, metadata }) => {
                console.log(
                    `📊 Recording metric: ${event} for user ${
                        userId || 'anonymous'
                    }`
                );
                console.log(`   📈 Metadata:`, metadata);

                // Here you would typically send to analytics platform
                // For demo, just log it
                return undefined;
            },
        }
    );

// Audit Service
const auditNeuron = withCtx()
    .neuron('audit-service', {})
    .bind(
        { auditLog },
        {
            auditLog: ({ action, userId, details, timestamp }) => {
                const logEntry = {
                    timestamp: new Date(timestamp).toISOString(),
                    action,
                    userId: userId || 'system',
                    details,
                };

                console.log(`📋 Audit Log:`, JSON.stringify(logEntry, null, 2));

                // Here you would typically persist to audit database
                return undefined;
            },
        }
    );

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
        devToolsServer = new CNSDevToolsServer(repository);
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

// Setup DevTools with WebSocket transport (optional)
console.log('🔧 DevTools CLIENT enabled:', DEVTOOLS_CLIENT_ENABLED);
if (DEVTOOLS_CLIENT_ENABLED) {
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
        devToolsInstanceName: 'E-commerce Demo App',
        takeDataSnapshot: () => ({
            timestamp: Date.now(),
            activeUsers: Array.from(users.values()).filter(
                u => u.isAuthenticated
            ).length,
            totalProducts: products.size,
            totalOrders: orders.size,
        }),
    });
    devtools.registerCNS(cns, 'root');

    console.log('🚀 E-commerce CNS app started with DevTools CLIENT enabled');
    console.log(`   📡 Connecting to DevTools server: ${wsUrl}`);
    console.log('   🎭 Complex demo scenarios will run every 8 seconds');
    console.log('   ⏳ Waiting for DevTools connection...');
} else {
    console.log('🚀 E-commerce CNS app started WITHOUT DevTools CLIENT');
}

// Real Developer Debugging Experience Guide
console.log(`
🚨 ===== CNStra DevTools Debugging Guide ===== 🚨

👨‍💻 REAL DEVELOPER EXPERIENCE: "My neurons show 0 signals!"

🔍 ACTUAL ISSUE DISCOVERED & FIXED:
The DevTools UI was querying the WRONG DATABASE TABLE!

❌ BEFORE: StimulationsPage queried "db.responses"
✅ AFTER: StimulationsPage now queries "db.stimulations"

📊 ROOT CAUSE ANALYSIS:
Looking at the logs above, you can see tons of activity:

🔍 SERVER LOGS show stimulations being received:
   ✅ "🧠 Server received stimulation: neuronId: ecommerce-app:auth-service"
   ✅ "🧠 Server received stimulation: neuronId: ecommerce-app:search-service"
   ✅ "🧠 Server received stimulation: neuronId: ecommerce-app:cart-service"

⚡ BUT UI showed 0 responses because of database table mismatch!

📋 HOW TO DEBUG SIMILAR ISSUES:

Step 1: Check server logs - are stimulations being received?
Step 2: Open DevTools at http://localhost:8080
Step 3: Navigate to "⚡ Stimulations" page
Step 4: If 0 responses despite server activity → check database queries
Step 5: Verify UI components query correct data tables

🚨 COMMON ISSUE TYPES:
   ❌ Wrong database table (like we had!)
   ❌ NeuronId prefix mismatches
   ❌ Communication failures between server/UI
   ❌ WebSocket connection issues

🔧 DEBUGGING PROCESS:
1. Server receiving data? ✅ (check console logs)
2. Server processing data? ✅ (check processing logs)
3. UI receiving data? ❌ (was the actual issue!)
4. UI displaying data? ❌ (consequence of wrong table)

✨ This demonstrates REAL production debugging! 🎯
`);

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

        // Scenario 5: Direct audit log test (ensure audit-service gets stimulated)
        console.log(
            `📋 Triggering direct audit log for demo scenario completion`
        );
        await cns.stimulate(
            auditLog.createSignal({
                action: 'demo_scenario_completed',
                userId: user.id,
                details: {
                    scenario: 'e-commerce-demo',
                    query,
                    productId: randomProductId,
                    completedAt: new Date().toISOString(),
                },
                timestamp: Date.now(),
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

runDemo();
